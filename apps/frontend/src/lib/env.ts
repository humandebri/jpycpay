import { z } from "zod";

const serverSchema = z.object({
  RELAYER_CANISTER_ID: z.string().min(1, "RELAYER_CANISTER_ID is required"),
  IC_HOST: z
    .string()
    .url("IC_HOST must be a valid URL")
    .default("https://ic0.app"),
  SERVER_RPC_URL: z
    .string()
    .url("SERVER_RPC_URL must be a valid URL")
    .optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_RELAYER_CANISTER_ID: z
    .string()
    .min(1, "NEXT_PUBLIC_RELAYER_CANISTER_ID is required"),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().default(80002),
  NEXT_PUBLIC_RPC_URL: z
    .string()
    .url("NEXT_PUBLIC_RPC_URL must be a valid URL")
    .optional(),
  NEXT_PUBLIC_JPYC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "NEXT_PUBLIC_JPYC_ADDRESS must be a checksummed address"),
  NEXT_PUBLIC_JPYC_ASSET_PRINCIPAL: z
    .string()
    .min(1, "NEXT_PUBLIC_JPYC_ASSET_PRINCIPAL is required"),
  NEXT_PUBLIC_RELAYER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  NEXT_PUBLIC_AUTH_VALIDITY_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(900),
});

export const clientEnv = (() => {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_RELAYER_CANISTER_ID:
      process.env.NEXT_PUBLIC_RELAYER_CANISTER_ID ?? "",
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_JPYC_ADDRESS: process.env.NEXT_PUBLIC_JPYC_ADDRESS ?? "",
    NEXT_PUBLIC_JPYC_ASSET_PRINCIPAL:
      process.env.NEXT_PUBLIC_JPYC_ASSET_PRINCIPAL ?? "",
    NEXT_PUBLIC_RELAYER_ADDRESS: process.env.NEXT_PUBLIC_RELAYER_ADDRESS,
    NEXT_PUBLIC_AUTH_VALIDITY_SECONDS:
      process.env.NEXT_PUBLIC_AUTH_VALIDITY_SECONDS,
  });

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid client environment configuration: ${message}`);
  }

  return parsed.data;
})();

export const getServerEnv = () => {
  const parsed = serverSchema.safeParse({
    RELAYER_CANISTER_ID:
      process.env.RELAYER_CANISTER_ID ??
      process.env.NEXT_PUBLIC_RELAYER_CANISTER_ID ??
      "",
    IC_HOST: process.env.IC_HOST ?? "https://ic0.app",
    SERVER_RPC_URL: process.env.SERVER_RPC_URL,
  });

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment configuration: ${message}`);
  }

  return parsed.data;
};
