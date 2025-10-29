"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  formatEther,
  formatUnits,
  parseUnits,
  hexToBytes,
  bytesToHex,
  type TypedDataDomain,
} from "viem";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import Link from "next/link";
import { clientEnv } from "@/lib/env";
import { publicClient } from "@/lib/viem";
import { ERC20_META_ABI } from "@/lib/abi/erc20Meta";

interface InfoResponse {
  relayer_canister_id: string;
  relayer_addr: string;
  threshold_wei: string;
  gas_wei: string;
  cycles_balance: string;
}

interface LogsResponseItem {
  id: string;
  ts: string;
  from: string;
  to: string;
  value: string;
  status: string;
  tx?: string;
  fail_reason?: string;
}

interface SubmitResponse {
  txHash: string;
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const tokenMetaQuery = useQuery({
    queryKey: ["token-meta"],
    queryFn: async () => {
      const res = await fetch("/api/token-meta", { cache: "no-cache" });
      if (!res.ok) {
        throw new Error("Failed to fetch token metadata");
      }
      return res.json() as Promise<{
        name: string;
        decimals: number;
      }>;
    },
    staleTime: Infinity,
  });

  const infoQuery = useQuery({
    queryKey: ["relayer-info"],
    queryFn: async (): Promise<InfoResponse> => {
      const res = await fetch("/api/info", { cache: "no-cache" });
      if (!res.ok) throw new Error("Failed to fetch relayer info");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const gasBalanceQuery = useQuery({
    queryKey: ["relayer-gas"],
    queryFn: async (): Promise<{ gas_wei: string }> => {
      const res = await fetch("/api/gas-balance", { cache: "no-cache" });
      if (!res.ok) throw new Error("Failed to fetch relayer gas balance");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const logsQuery = useQuery({
    queryKey: ["relayer-logs"],
    queryFn: async (): Promise<{ logs: LogsResponseItem[] }> => {
      const res = await fetch("/api/logs?limit=20", { cache: "no-cache" });
      if (!res.ok) throw new Error("Failed to fetch relayer logs");
      return res.json();
    },
    refetchInterval: 20_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      setLastError(null);
      setLastResult(null);

      if (!walletClient || !address) {
        throw new Error("ウォレットが接続されていません");
      }

      if (!tokenMetaQuery.data) {
        throw new Error("トークン情報の取得を待っています");
      }

      const { name, decimals } = tokenMetaQuery.data;
      const value = parseUnits(amount, decimals);
      const now = Math.floor(Date.now() / 1000);
      const validBefore = BigInt(
        now + clientEnv.NEXT_PUBLIC_AUTH_VALIDITY_SECONDS,
      );
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonceHex = bytesToHex(nonceBytes);

      const message = {
        from: address as `0x${string}`,
        to: toAddress as `0x${string}`,
        value,
        validAfter: BigInt(0),
        validBefore,
        nonce: nonceHex,
      } as const;

      const domain: TypedDataDomain = {
        name,
        chainId: BigInt(clientEnv.NEXT_PUBLIC_CHAIN_ID),
        verifyingContract: clientEnv.NEXT_PUBLIC_JPYC_ADDRESS as `0x${string}`,
      };
      domain.version = "1";

      const signature = await walletClient.signTypedData({
        account: address,
        domain,
        primaryType: "TransferWithAuthorization",
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        message,
      });

      const r = `0x${signature.slice(2, 66)}`;
      const s = `0x${signature.slice(66, 130)}`;
      const sigBytes = hexToBytes(signature);
      const v = sigBytes[sigBytes.length - 1];

      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetPrincipal: clientEnv.NEXT_PUBLIC_JPYC_ASSET_PRINCIPAL,
          from: message.from,
          to: message.to,
          value: value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce: nonceHex,
          signature: { v, r, s },
        }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error ?? "リレー送信に失敗しました");
      }

      const data = (await response.json()) as SubmitResponse;
      await queryClient.invalidateQueries({ queryKey: ["relayer-logs"] });
      return data;
    },
    onSuccess(data) {
      setLastResult(data.txHash);
      setAmount("");
      setToAddress("");
    },
    onError(error) {
      setLastError(error instanceof Error ? error.message : String(error));
    },
  });

  const connector = connectors[0];
  const gasBalance = gasBalanceQuery.data
    ? formatEther(BigInt(gasBalanceQuery.data.gas_wei))
    : null;
  const threshold = infoQuery.data
    ? formatEther(BigInt(infoQuery.data.threshold_wei))
    : null;
  const cyclesBalance = infoQuery.data
    ? BigInt(infoQuery.data.cycles_balance)
    : null;
  const explorerBase =
    clientEnv.NEXT_PUBLIC_CHAIN_ID === 137
      ? "https://polygonscan.com"
      : "https://amoy.polygonscan.com";
  const tipAddress = "0x88F88c9667ECB746c11b8a0182f11F622FFbb844";
  const logs = logsQuery.data?.logs ?? [];

  const handleCopyTipAddress = async () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    try {
      await navigator.clipboard.writeText(tipAddress);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    copyTimeoutRef.current = setTimeout(() => setCopyStatus("idle"), 2000);
  };

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-100 pb-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-12 lg:px-8">
        <header className="space-y-4">
          <Badge variant="secondary" className="uppercase tracking-wide">
            JPYC Gasless Relay
          </Badge>
          <h1 className="text-3xl font-semibold text-neutral-900">
            ガスレス送金オーソライズ
          </h1>
          <p className="text-sm text-neutral-600">
            Polygon Mainnet 上の JPYC を EIP-3009 署名のみで転送。ICP リレーがガス支払い（POL）とブロードキャストを代行します。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/docs/overview">仕組みを詳しく知る</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/docs/comparison">他方式との比較を見る</Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-neutral-200">
            <CardHeader className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle>送金オーソライゼーション</CardTitle>
                  <CardDescription>
                    ウォレットで署名し、ICP リレーに送信します。
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <div className="flex items-center gap-3 text-xs text-neutral-500">
                      <span className="line-clamp-1 font-mono text-neutral-600">
                        {address}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnect()}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => connector && connect({ connector })}
                      disabled={!connector || isConnecting}
                    >
                      {isConnecting ? "接続中…" : "ウォレット接続"}
                    </Button>
                  )}
                </div>
              </div>
              {chainId && chainId !== clientEnv.NEXT_PUBLIC_CHAIN_ID ? (
                <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3">
                  <p className="text-xs text-amber-900">
                    現在のチェーン ID ({chainId}) が必要なチェーン ID
                    ({clientEnv.NEXT_PUBLIC_CHAIN_ID}) と異なります。
                  </p>
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        switchChain({
                          chainId: clientEnv.NEXT_PUBLIC_CHAIN_ID,
                        })
                      }
                      disabled={isSwitching}
                    >
                      {isSwitching ? "切り替え中…" : "ウォレットでチェーンを切り替える"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardHeader>

            <CardContent className="space-y-5">
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="toAddress">送り先アドレス</Label>
                  <Input
                    id="toAddress"
                    placeholder="0x…"
                    value={toAddress}
                    onChange={(event) => setToAddress(event.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">金額 (JPYC)</Label>
                  <Input
                    id="amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    !isConnected ||
                    mutation.isPending ||
                    !toAddress ||
                    !amount ||
                    chainId !== clientEnv.NEXT_PUBLIC_CHAIN_ID
                  }
                >
                  {mutation.isPending ? (
                    <>
                      <Spinner className="mr-2 size-4" />
                      署名中…
                    </>
                  ) : (
                    "署名してリレーへ送信"
                  )}
                </Button>

                <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-xs text-neutral-600">
                  <p >
                    tECDSAのコストにより1回3.5円かかります😇
                  </p>
                  <p className="mb-3">
                    もし気に入っていただけたらJPYCをカンパいただけると嬉しいです。
                    下記アドレスをウォレットに貼り付けて送付してください。
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 font-mono text-[11px] text-neutral-700 break-all">
                      {tipAddress}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button size="sm" variant="secondary" onClick={handleCopyTipAddress}>
                        アドレスをコピー
                      </Button>
                      {copyStatus === "copied" ? (
                        <span className="text-[11px] text-emerald-600">
                          コピーしました、ありがとうございます！
                        </span>
                      ) : copyStatus === "failed" ? (
                        <span className="text-[11px] text-rose-600">
                          コピーに失敗しました。手動でコピーしてください。
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </form>

              <div className="space-y-2 text-xs">
                {lastResult ? (
                  <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-emerald-800">
                    送信成功。Tx ハッシュ:
                    <br />
                    <a
                      className="underline"
                      href={`${explorerBase}/tx/${lastResult}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {lastResult}
                    </a>
                  </div>
                ) : null}
                {lastError ? (
                  <div className="rounded-xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-rose-700">
                    {lastError}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-neutral-200 bg-white">
              <CardHeader>
                <CardTitle>リレー状況</CardTitle>
                <CardDescription>
                  ガス残高としきい値を定期的にポーリングします。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {infoQuery.isLoading || gasBalanceQuery.isLoading ? (
                  <p className="text-neutral-500">読み込み中…</p>
                ) : infoQuery.isError || gasBalanceQuery.isError ? (
                  <p className="text-rose-500">情報の取得に失敗しました。</p>
                ) : (
                  <>
                    <div>
                      <span className="text-neutral-500">Relayer address</span>
                      <p className="font-mono text-xs text-neutral-700">
                        {infoQuery.data?.relayer_addr ?? "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Relayer canister</span>
                      <p className="font-mono text-xs text-neutral-700">
                        {infoQuery.data?.relayer_canister_id ?? "-"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-neutral-600">
                      <span>Gas balance</span>
                      <span className="font-medium text-neutral-900">
                        {gasBalance ?? "-"} POL
                      </span>
                    </div>
                <div className="flex items-center justify-between text-xs text-neutral-600">
                  <span>Threshold</span>
                  <span className="font-medium text-neutral-900">
                    {threshold ?? "-"} MATIC
                  </span>
                </div>
                    <div className="flex items-center justify-between text-xs text-neutral-600">
                      <span>Cycles balance</span>
                      <span className="font-medium text-neutral-900 text-right">
                        {cyclesBalance !== null ? (
                          <>
                            <span className="block text-[10px] text-neutral-500">
                              {cyclesBalance.toLocaleString("en-US")}
                            </span>
                            <span className="block">
                              {(Number(cyclesBalance) / 1_000_000_000_000).toLocaleString(
                                "en-US",
                                {
                                  minimumFractionDigits: 3,
                                  maximumFractionDigits: 3,
                                },
                              )}{" "}
                              TC
                            </span>
                          </>
                        ) : (
                          "-"
                        )}
                      </span>
                    </div>
              </>
            )}
              </CardContent>
            </Card>

            <Card className="border-neutral-200 bg-white">
              <CardHeader>
                <CardTitle>アクティビティログ (最新 20 件)</CardTitle>
                <CardDescription>
                  ステータスとエラー理由を確認できます。
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-80 space-y-3 overflow-y-auto pr-2 text-xs">
                {logsQuery.isLoading ? (
                  <p className="text-neutral-500">読み込み中…</p>
                ) : logsQuery.isError ? (
                  <p className="text-rose-500">ログの取得に失敗しました。</p>
                ) : logs.length === 0 ? (
                  <p className="text-neutral-500">まだログがありません。</p>
                ) : (
                  logs.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={
                            entry.status === "failed"
                              ? "destructive"
                              : entry.status === "broadcasted"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {entry.status}
                        </Badge>
                        <span className="text-[10px] text-neutral-500">
                          {new Date(Number(entry.ts) * 1000).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 font-mono text-[11px] text-neutral-600">
                        <div>From: {entry.from}</div>
                        <div>To: {entry.to}</div>
                        <div>
                          Amount: {formatUnits(
                            BigInt(entry.value),
                            tokenMetaQuery.data?.decimals ?? 18,
                          )}{" "}
                          JPYC
                        </div>
                        {entry.tx ? (
                          <div>
                            Tx: {" "}
                            <a
                              className="text-neutral-700 underline"
                              href={`${explorerBase}/tx/${entry.tx}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {entry.tx}
                            </a>
                          </div>
                        ) : null}
                        {entry.fail_reason ? (
                          <div className="text-rose-500">
                            Reason: {entry.fail_reason}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
