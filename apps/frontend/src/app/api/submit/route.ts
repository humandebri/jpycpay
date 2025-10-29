import { NextResponse } from "next/server";
import { z } from "zod";
import { hexToBytes } from "viem";
import { Principal } from "@dfinity/principal";
import { getRelayerActor } from "@/lib/relayer-client";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  assetPrincipal: z.string().min(1),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  value: z.string().min(1),
  validAfter: z.string().default("0"),
  validBefore: z.string().min(1),
  nonce: z.string().regex(/^0x[0-9a-fA-F]+$/),
  signature: z.object({
    v: z.number().int().min(0).max(255),
    r: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    s: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
});

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = payloadSchema.safeParse(json);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const payload = parsed.data;
  const actor = await getRelayerActor();

  const result = await actor.submit_authorization({
    asset: Principal.fromText(payload.assetPrincipal),
    from: hexToBytes(payload.from as `0x${string}`),
    to: hexToBytes(payload.to as `0x${string}`),
    value: BigInt(payload.value),
    valid_after: BigInt(payload.validAfter ?? "0"),
    valid_before: BigInt(payload.validBefore),
    nonce: hexToBytes(payload.nonce as `0x${string}`),
    sig_v: payload.signature.v,
    sig_r: hexToBytes(payload.signature.r as `0x${string}`),
    sig_s: hexToBytes(payload.signature.s as `0x${string}`),
  });

  if ("Err" in result) {
    return NextResponse.json(
      { error: result.Err },
      { status: 502 },
    );
  }

  return NextResponse.json({ txHash: result.Ok });
}
