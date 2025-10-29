import { NextResponse } from "next/server";
import { clientEnv, getServerEnv } from "@/lib/env";
import { publicClient } from "@/lib/viem";
import { ERC20_META_ABI } from "@/lib/abi/erc20Meta";
import { appChain } from "@/lib/wagmi";
import { createPublicClient, http } from "viem";

export async function GET() {
  const address = clientEnv.NEXT_PUBLIC_JPYC_ADDRESS as `0x${string}`;
  const serverEnv = getServerEnv();
  const rpcClient = serverEnv.SERVER_RPC_URL
    ? createPublicClient({
        chain: appChain,
        transport: http(serverEnv.SERVER_RPC_URL),
      })
    : publicClient;

  try {
    const [name, decimals] = await Promise.all([
      rpcClient.readContract({
        address,
        abi: ERC20_META_ABI,
        functionName: "name",
      }),
      rpcClient.readContract({
        address,
        abi: ERC20_META_ABI,
        functionName: "decimals",
      }),
    ]);

    return NextResponse.json({
      name: String(name),
      decimals: Number(decimals),
    });
  } catch (error) {
    console.error("Failed to fetch token metadata", error);
    return NextResponse.json(
      { error: "Failed to fetch token metadata" },
      { status: 500 },
    );
  }
}
