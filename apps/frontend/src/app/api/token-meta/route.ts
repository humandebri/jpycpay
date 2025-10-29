import { NextResponse } from "next/server";
import { clientEnv } from "@/lib/env";
import { publicClient } from "@/lib/viem";
import { ERC20_META_ABI } from "@/lib/abi/erc20Meta";

export async function GET() {
  const address = clientEnv.NEXT_PUBLIC_JPYC_ADDRESS as `0x${string}`;

  const [name, version, decimals] = await Promise.all([
    publicClient.readContract({
      address,
      abi: ERC20_META_ABI,
      functionName: "name",
    }),
    publicClient.readContract({
      address,
      abi: ERC20_META_ABI,
      functionName: "version",
    }),
    publicClient.readContract({
      address,
      abi: ERC20_META_ABI,
      functionName: "decimals",
    }),
  ]);

  return NextResponse.json({
    name: String(name),
    version: String(version),
    decimals: Number(decimals),
  });
}
