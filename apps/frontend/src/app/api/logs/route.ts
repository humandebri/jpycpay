import { NextResponse } from "next/server";
import { getRelayerActor } from "@/lib/relayer-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startAfterParam = searchParams.get("startAfter");
  const limitParam = searchParams.get("limit");

  const startAfter: [] | [bigint] = startAfterParam
    ? [BigInt(startAfterParam)]
    : [];
  const limit = limitParam ? Number(limitParam) : 20;

  const actor = await getRelayerActor();
  const logs = await actor.logs(startAfter, limit);

  return NextResponse.json({
    logs: logs.map((entry) => ({
      id: entry.id.toString(),
      ts: entry.ts.toString(),
      from: entry.from,
      to: entry.to,
      value: entry.value.toString(),
      status: entry.status,
      tx: entry.tx.length ? entry.tx[0] : undefined,
      fail_reason: entry.fail_reason.length ? entry.fail_reason[0] : undefined,
    })),
  });
}
