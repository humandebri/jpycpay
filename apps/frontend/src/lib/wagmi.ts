import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { polygon, polygonAmoy } from "wagmi/chains";
import { defineChain } from "viem";
import type { Chain } from "viem";
import { injected } from "@wagmi/connectors";
import { clientEnv } from "@/lib/env";

const knownChains = [polygon, polygonAmoy];
const chainId = Number(clientEnv.NEXT_PUBLIC_CHAIN_ID);

let resolvedChain: Chain | undefined = knownChains.find(
  (chain) => chain.id === chainId,
);

if (!resolvedChain) {
  const rpcUrl = clientEnv.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      `Unsupported chain id ${chainId}. Provide NEXT_PUBLIC_RPC_URL to configure a custom chain.`,
    );
  }

  resolvedChain = defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    network: `chain-${chainId}`,
    nativeCurrency: {
      name: "POL",
      symbol: "POL",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: {
        name: "PolygonScan",
        url: "https://polygonscan.com",
        apiUrl: "https://api.polygonscan.com/api",
      },
    },
  });
}

const transportUrl =
  clientEnv.NEXT_PUBLIC_RPC_URL ?? resolvedChain.rpcUrls.default.http[0];

export const wagmiConfig = createConfig({
  chains: [resolvedChain],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [resolvedChain.id]: http(transportUrl),
  },
});

export const appChain = resolvedChain;
export const appRpcUrl = transportUrl;
