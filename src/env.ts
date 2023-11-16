import { KVNamespace, Hyperdrive } from "@cloudflare/workers-types";

export type SupportedChainId = "0x534e5f474f45524c49" | "0x534e5f4d41494e";

// declare what's available in our env
export interface Env {
  STARKNET_CHAIN_ID: SupportedChainId;

  PG_CONNECTION_STRING?: string;

  HYPERDRIVE?: Hyperdrive;

  TOKEN_LOGOS_KV?: KVNamespace;
}
