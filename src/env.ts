import { D1Database, Hyperdrive, RateLimit } from "@cloudflare/workers-types";

export interface Env {
  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;

  // Wallet to X account links (src/routes/identity). Without IDENTITY_DB the
  // identity routes answer 503; without the X secrets linking cannot start.
  readonly IDENTITY_DB?: D1Database;
  /** Origin of this Worker, for the X OAuth callback URL. */
  readonly PUBLIC_ORIGIN?: string;
  /** Comma-separated origins a link may return to; `https://*.host` allowed. */
  readonly X_LINK_RETURN_ORIGINS?: string;
  readonly X_CLIENT_ID?: string;
  readonly X_CLIENT_SECRET?: string;
  /** JSON object of decimal chain ID to RPC URL, overriding the public RPCs. */
  readonly RPC_URLS?: string;
  readonly IDENTITY_IP_LIMITER?: RateLimit;
  readonly IDENTITY_ADDRESS_LIMITER?: RateLimit;
}
