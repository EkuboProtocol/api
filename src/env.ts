import { Hyperdrive } from "@cloudflare/workers-types";

export interface Env {
  readonly CHAIN_ID: string;

  readonly ORACLE_ADDRESS: string;

  readonly TWAMM_ADDRESS: string;

  readonly MEV_CAPTURE_ADDRESS: string;

  readonly ADDITIONAL_TOKEN_LISTS?: string;

  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;

  readonly ZERO_X_API_KEY: string;
}
