import { Hyperdrive, KVNamespace } from "@cloudflare/workers-types";
import { constants } from "starknet";

export interface Env {
  readonly STARKNET_CHAIN_ID: constants.StarknetChainId;

  readonly ETH_TOKEN_ADDRESS: string;
  readonly STRK_TOKEN_ADDRESS: string;

  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;

  readonly TOKEN_LOGOS_KV?: KVNamespace;

  readonly TWAMM_ADDRESS: string;
}
