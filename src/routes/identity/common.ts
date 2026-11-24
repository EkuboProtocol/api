// Helpers shared by the wallet-side link routes (index.ts) and the X-side
// unlink routes (xUnlink.ts).
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../../shared/context";
import { StatusError } from "../../shared/errors";
import type { Chain } from "./chains";
import { CODE_PATTERN, normalizeCode, sha256 } from "./crypto";
import {
  MAX_CODE_FAILURES,
  recordCodeFailure,
  type AttemptTable,
} from "./store";

export const LINK_TTL_SECONDS = 600;
export const NO_STORE = { "cache-control": "no-store" };

export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export type Ctx = Context<AppEnv>;

function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/**
 * Applies the per-IP limit, and with an address the per-address limit.
 *
 * The address bucket is keyed by IP as well: every route can be called for
 * any address without proving control of it (start and unlink/message need
 * no proof, and complete and DELETE can be driven with the caller's own
 * attempt or nonce), so a bucket shared by all callers would let a stranger
 * lock the owner out of unlinking. A missing limiter binding is a
 * misconfiguration, answered with 503 rather than running unlimited.
 */
export async function limit(c: Ctx, chain?: Chain, address?: string) {
  const ipLimiter = c.env.IDENTITY_IP_LIMITER;
  const addressLimiter = c.env.IDENTITY_ADDRESS_LIMITER;
  if (!ipLimiter || !addressLimiter) {
    throw new StatusError(
      503,
      "X linking is not available: rate limits are not configured",
    );
  }
  const ip = clientIp(c);
  const checks = [ipLimiter.limit({ key: ip })];
  if (chain && address) {
    checks.push(
      addressLimiter.limit({ key: `${ip}|${chain.namespace}:${address}` }),
    );
  }
  const outcomes = await Promise.all(checks);
  if (outcomes.some((outcome) => !outcome.success)) {
    throw new StatusError(429, "Too many requests; wait a minute and retry");
  }
}

/**
 * Checks a completion code against an attempt; a wrong one counts against
 * the attempt, which is discarded after MAX_CODE_FAILURES.
 */
export async function checkCode(
  db: D1Database,
  table: AttemptTable,
  attempt: { id_hash: string; code_hash: string | null; code_failures: number },
  code: string,
) {
  const normalized = normalizeCode(code);
  if (
    CODE_PATTERN.test(normalized) &&
    (await sha256(normalized)) === attempt.code_hash
  ) {
    return;
  }
  await recordCodeFailure(db, attempt.id_hash, table);
  const left = MAX_CODE_FAILURES - attempt.code_failures - 1;
  throw new StatusError(
    403,
    left > 0
      ? `The code is wrong; ${left} ${left === 1 ? "try" : "tries"} left`
      : `The code is wrong; this ${table === "link_attempts" ? "link" : "unlink"} is discarded, start again`,
  );
}
