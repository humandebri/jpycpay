import { createPublicClient, http } from "viem";
import { appChain, appRpcUrl } from "@/lib/wagmi";

export const publicClient = createPublicClient({
  chain: appChain,
  transport: http(appRpcUrl),
});
