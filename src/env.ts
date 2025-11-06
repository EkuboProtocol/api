import { Hyperdrive } from "@cloudflare/workers-types";

export interface Env {
  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;

  readonly ZERO_X_API_KEY: string;
}
