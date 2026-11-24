import { D1Database, Hyperdrive, RateLimit } from "@cloudflare/workers-types";

export interface Env {
  readonly PG_CONNECTION_STRING?: string;

  readonly HYPERDRIVE?: Hyperdrive;

  // Wallet to X account links (src/routes/identity). Every deployment has
  // them: these bindings, vars and secrets are required, not a switch.
  readonly IDENTITY_DB: D1Database;
  /** Origin of this Worker, for the X OAuth callback URL. */
  readonly PUBLIC_ORIGIN: string;
  /** Comma-separated origins a link may return to; `https://*.host` allowed. */
  readonly X_LINK_RETURN_ORIGINS: string;
  readonly X_CLIENT_ID: string;
  readonly X_CLIENT_SECRET: string;
  /** Key of Ekubo's Alchemy app, used to check contract-account signatures. */
  readonly ALCHEMY_API_KEY: string;
  /** A missing limiter is a misconfiguration; the identity routes 503. */
  readonly IDENTITY_IP_LIMITER: RateLimit;
  readonly IDENTITY_ADDRESS_LIMITER: RateLimit;
}
