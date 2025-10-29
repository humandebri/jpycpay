import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory, type _SERVICE } from "@/lib/relayer.idl";
import { getServerEnv } from "@/lib/env";

let cachedActor: ActorSubclass<_SERVICE> | null = null;

export async function getRelayerActor(): Promise<ActorSubclass<_SERVICE>> {
  if (cachedActor) {
    return cachedActor;
  }

  const { RELAYER_CANISTER_ID, IC_HOST } = getServerEnv();
  const agent = new HttpAgent({ host: IC_HOST });

  if (process.env.NODE_ENV !== "production") {
    try {
      await agent.fetchRootKey();
    } catch (error) {
      console.warn("Failed to fetch root key; running against mainnet?");
    }
  }

  cachedActor = Actor.createActor<_SERVICE>(idlFactory as any, {
    agent,
    canisterId: Principal.fromText(RELAYER_CANISTER_ID),
  });

  return cachedActor;
}

export function invalidateRelayerActor() {
  cachedActor = null;
}
