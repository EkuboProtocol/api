import { Hyperdrive } from "@cloudflare/workers-types";

export interface Env {
  readonly CHAIN_ID: string;

  readonly ADDITIONAL_TOKEN_LISTS?: string;

  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;
}
