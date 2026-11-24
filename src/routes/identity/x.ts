// Sign in with X: OAuth 2.0 authorization code with PKCE, as a confidential
// client. Copied from the token chat (interface chat/src/x.ts) with the same
// rules: only the numeric X user ID and the current handle are kept, the
// access token is used once for /2/users/me and revoked straight away, and no
// refresh token is requested (no offline.access scope). Keep the two in step.
import type { Env } from "../../env";
import { sha256 } from "./crypto";

const SCOPES = "users.read tweet.read";
const PROVIDER_TIMEOUT_MS = 10_000;

export interface XAccount {
  /** Immutable numeric user ID. */
  readonly id: string;
  /** Handle at the time of linking, without the @. */
  readonly username: string;
}

export function callbackUrl(env: Env): string {
  return `${env.PUBLIC_ORIGIN.replace(/\/$/, "")}/v1/identity/x/callback`;
}

function basicAuth(env: Env) {
  return `Basic ${btoa(`${encodeURIComponent(env.X_CLIENT_ID)}:${encodeURIComponent(env.X_CLIENT_SECRET)}`)}`;
}

export async function authorizationUrl(
  env: Env,
  state: string,
  verifier: string,
): Promise<string> {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    scope: SCOPES,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function accessTokenOf(token: unknown): string | null {
  const accessToken =
    token && typeof token === "object" && "access_token" in token
      ? token.access_token
      : null;
  // Validate the bearer grammar before constructing an Authorization header.
  return typeof accessToken === "string" &&
    /^[A-Za-z0-9._~+/-]+=*$/.test(accessToken)
    ? accessToken
    : null;
}

export function accountOf(profile: unknown): XAccount | null {
  const data =
    profile && typeof profile === "object" && "data" in profile
      ? profile.data
      : null;
  if (!data || typeof data !== "object") return null;
  const { id, username } = data as { id?: unknown; username?: unknown };
  if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) return null;
  if (typeof username !== "string" || !/^\w{1,15}$/.test(username)) {
    return null;
  }
  return { id, username };
}

async function revoke(env: Env, accessToken: string) {
  await fetch("https://api.x.com/2/oauth2/revoke", {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(env),
    },
    body: new URLSearchParams({
      token: accessToken,
      token_type_hint: "access_token",
    }),
  }).catch(() => undefined);
}

export async function verifiedXAccount(
  env: Env,
  code: string,
  verifier: string,
): Promise<XAccount | null> {
  const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(env),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    const failure = (await tokenResponse.json().catch(() => null)) as {
      error?: unknown;
      error_description?: unknown;
    } | null;
    console.warn("x_link", {
      stage: "token",
      status: tokenResponse.status,
      error: typeof failure?.error === "string" ? failure.error : "",
      description:
        typeof failure?.error_description === "string"
          ? failure.error_description.slice(0, 200)
          : "",
    });
    return null;
  }
  const accessToken = accessTokenOf(await tokenResponse.json());
  if (accessToken === null) return null;
  try {
    const me = await fetch("https://api.x.com/2/users/me", {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) {
      console.warn("x_link", { stage: "users_me", status: me.status });
      return null;
    }
    return accountOf(await me.json());
  } finally {
    await revoke(env, accessToken);
  }
}
