import { KVNamespace, Hyperdrive } from "@cloudflare/workers-types";
import { constants } from "starknet";

export interface Env {
  STARKNET_CHAIN_ID: constants.StarknetChainId;

  RPC_URL: string;

  PG_CONNECTION_STRING?: string;

  HYPERDRIVE?: Hyperdrive;

  TOKEN_LOGOS_KV?: KVNamespace;
}
