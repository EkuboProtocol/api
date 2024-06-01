import { Hyperdrive, KVNamespace } from "@cloudflare/workers-types";
import { constants } from "starknet";

export interface Env {
  readonly STARKNET_CHAIN_ID: constants.StarknetChainId;

  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;
}
