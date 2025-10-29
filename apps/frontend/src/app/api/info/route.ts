import { NextResponse } from "next/server";
import { getRelayerActor } from "@/lib/relayer-client";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getServerEnv();
  const actor = await getRelayerActor();
  const info = await actor.info();

  return NextResponse.json({
    relayer_canister_id: env.RELAYER_CANISTER_ID,
    relayer_addr: info.relayer_addr,
    threshold_wei: info.threshold_wei.toString(),
    gas_wei: info.gas_wei.toString(),
    cycles_balance: info.cycles_balance.toString(),
  });
}
