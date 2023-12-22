import { Env } from "../env";
import { RpcProvider } from "starknet";

let provider: RpcProvider | null = null;

export function getProvider(env: Env): RpcProvider {
  return (
    provider ??
    (provider = new RpcProvider({
      nodeUrl: env.RPC_URL,
      chainId: env.STARKNET_CHAIN_ID,
    }))
  );
}
