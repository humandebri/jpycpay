import { NextResponse } from "next/server";
import { clientEnv, getServerEnv } from "@/lib/env";
import { appChain } from "@/lib/wagmi";
import { publicClient } from "@/lib/viem";
import { createPublicClient, http } from "viem";

export async function GET() {
  const relayerAddress = clientEnv.NEXT_PUBLIC_RELAYER_ADDRESS;
  if (!relayerAddress) {
    return NextResponse.json(
      { error: "Relayer address not configured" },
      { status: 400 },
    );
  }

  const serverEnv = getServerEnv();
  const rpcClient = serverEnv.SERVER_RPC_URL
    ? createPublicClient({
        chain: appChain,
        transport: http(serverEnv.SERVER_RPC_URL),
      })
    : publicClient;

  try {
    const balance = await rpcClient.getBalance({
      address: relayerAddress as `0x${string}`,
    });
    return NextResponse.json({ gas_wei: balance.toString() });
  } catch (error) {
    console.error("Failed to fetch relayer gas balance", error);
    return NextResponse.json(
      { error: "Failed to fetch relayer gas balance" },
      { status: 500 },
    );
  }
}
