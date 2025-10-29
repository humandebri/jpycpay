import { NextResponse } from "next/server";
import { getRelayerActor } from "@/lib/relayer-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getRelayerActor();
  const info = await actor.info();

  return NextResponse.json({
    relayer_addr: info.relayer_addr,
    threshold_wei: info.threshold_wei.toString(),
    gas_wei: info.gas_wei.toString(),
  });
}
