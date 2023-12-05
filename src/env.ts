import { KVNamespace, Hyperdrive } from "@cloudflare/workers-types";
import { constants } from "starknet";

// declare what's available in our env
export interface Env {
  STARKNET_CHAIN_ID: constants.StarknetChainId;

  RPC_URL: string;

  PG_CONNECTION_STRING?: string;

  HYPERDRIVE?: Hyperdrive;

  TOKEN_LOGOS_KV?: KVNamespace;
}
