// Unlinking from the X side. Whoever controls an X account for a moment can
// link their own wallet to it; once the owner has the account back, this lets
// them remove every link to it without any wallet, by signing in with X
// again. The rules are those of linking: single-use OAuth state, a PKCE
// verifier bound to the attempt, a completion code shown only to the browser
// that approved on X, and the unlink ID held by whoever started it. The X
// callback alone removes nothing.
import { createRoute, z } from "@hono/zod-openapi";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../env";
import { defineRoute } from "../../shared/context";
import { errorResponses, StatusError } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { callbackPage, returnUrl, validReturnTo } from "./callback";
import {
  checkCode,
  database,
  iso,
  limit,
  LINK_TTL_SECONDS,
  NO_STORE,
  nowSeconds,
  type Ctx,
} from "./common";
import { completionCode, randomToken, sha256 } from "./crypto";
import {
  UnlinkIdType,
  XUnlinkCompleteRequestType,
  XUnlinkCompleteResponseType,
  xUnlinkErrors,
  XUnlinkStartRequestType,
  XUnlinkStartResponseType,
} from "./schemas";
import {
  createUnlinkAttempt,
  getUnlinkAttempt,
  NAMESPACE_SCOPE,
  recordUnlinkXResult,
  removeLinksOfXUser,
  takeUnlinkAttemptByState,
} from "./store";
import { authorizationUrl, verifiedXAccount, xConfigured } from "./x";

export const StartXUnlink = defineRoute(
  createRoute({
    method: "post",
    path: "/v1/identity/x/unlink/start",
    tags: ["Identity"],
    summary: "Start removing an X account's links",
    description:
      "For the owner of an X account: removes every link between that X account and wallet addresses, proven by signing in with X, without a wallet. Returns the x.com authorization URL for the person to open and a private unlink ID. Then POST /v1/identity/x/unlink/{unlink_id}/complete with the code from X. Expires in 10 minutes",
    operationId: "post_StartXUnlink",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: XUnlinkStartRequestType } },
      },
    },
    responses: {
      200: jsonResponse("Unlink started", XUnlinkStartResponseType),
      ...errorResponses,
      ...xUnlinkErrors,
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = database(c.env);
    if (!xConfigured(c.env)) {
      throw new StatusError(503, "Sign in with X is not configured here");
    }
    const returnTo = body.return_to ?? null;
    if (returnTo !== null && !validReturnTo(c.env, returnTo)) {
      throw new StatusError(400, "return_to is not an allowed Ekubo page");
    }
    await limit(c);
    const unlinkId = randomToken();
    const state = randomToken();
    const verifier = randomToken(48);
    const now = nowSeconds();
    await createUnlinkAttempt(db, {
      idHash: await sha256(unlinkId),
      stateHash: await sha256(state),
      verifier,
      returnTo,
      now,
      expiresAt: now + LINK_TTL_SECONDS,
    });
    return c.json(
      {
        unlink_id: unlinkId,
        authorization_url: await authorizationUrl(c.env, state, verifier),
        expires_at: iso(now + LINK_TTL_SECONDS),
      },
      200,
      NO_STORE,
    );
  },
);

async function verifyUnlinkOnX(
  env: Env,
  db: D1Database,
  attempt: { id_hash: string; verifier: string },
  code: string,
) {
  const account = await verifiedXAccount(env, code, attempt.verifier).catch(
    () => null,
  );
  if (!account) return null;
  const completion = completionCode();
  await recordUnlinkXResult(db, {
    idHash: attempt.id_hash,
    xUserId: account.id,
    xHandle: account.username,
    codeHash: await sha256(completion),
    expiresAt: nowSeconds() + LINK_TTL_SECONDS,
  });
  return { account, completion };
}

/**
 * The X callback for an unlink, if the state belongs to one; null if not.
 * Records the verified X account and hands out the completion code; removes
 * nothing.
 */
export async function unlinkCallback(
  c: Ctx,
  db: D1Database,
  stateHash: string,
  code: string | undefined,
) {
  const attempt = await takeUnlinkAttemptByState(db, stateHash, nowSeconds());
  if (!attempt) return null;
  const result = code ? await verifyUnlinkOnX(c.env, db, attempt, code) : null;
  const outcome = !code ? "cancelled" : result ? "complete" : "failed";
  if (attempt.return_to) {
    return c.redirect(
      returnUrl(attempt.return_to, outcome, result?.completion, "unlink"),
      302,
    );
  }
  return callbackPage(c, {
    flow: "unlink",
    outcome,
    code: result?.completion,
    handle: result?.account.username,
  });
}

export const CompleteXUnlink = defineRoute(
  createRoute({
    method: "post",
    path: "/v1/identity/x/unlink/{unlink_id}/complete",
    tags: ["Identity"],
    summary: "Remove an X account's links",
    description:
      "With the code shown after signing in on X, removes every link between that X account and wallet addresses, on every chain, and discards links to it still in progress. Removed links are kept in history",
    operationId: "post_CompleteXUnlink",
    request: {
      params: z.object({ unlink_id: UnlinkIdType }),
      body: {
        required: true,
        content: {
          "application/json": { schema: XUnlinkCompleteRequestType },
        },
      },
    },
    responses: {
      200: jsonResponse("Unlinked", XUnlinkCompleteResponseType),
      ...errorResponses,
      ...xUnlinkErrors,
    },
  }),
  async (c) => {
    const { unlink_id } = c.req.valid("param");
    const { code } = c.req.valid("json");
    const db = database(c.env);
    await limit(c);
    const idHash = await sha256(unlink_id);
    const attempt = await getUnlinkAttempt(db, idHash, nowSeconds());
    if (!attempt) {
      throw new StatusError(404, "Unlink not found or expired; start again");
    }
    if (attempt.x_user_id === null) {
      throw new StatusError(409, "The person has not signed in on X yet");
    }
    await checkCode(db, "unlink_attempts", attempt, code);
    const removed = await removeLinksOfXUser(
      db,
      attempt.x_user_id,
      nowSeconds(),
      "x_unlinked",
      idHash,
    );
    return c.json(
      {
        x_user_id: attempt.x_user_id,
        x_handle: attempt.x_handle!,
        removed: removed.map((row) => ({
          address: row.address,
          scope:
            row.chain_scope === NAMESPACE_SCOPE
              ? ("namespace" as const)
              : ("chain" as const),
          verified_chain_id: row.verified_chain_id,
        })),
      },
      200,
      NO_STORE,
    );
  },
);
