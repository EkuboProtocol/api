// Wallet to X account links (EKU-3113).
//
// The link flow proves two things separately and only links when both hold:
// the X account, by Sign in with X, and control of the address, by a wallet
// signature over a message naming that X account. The X callback never links
// on its own. It hands a completion code only to the browser that approved on
// X, and reading the message or completing the link needs that code as well
// as the link ID held by whoever started it, so an approval obtained by
// sending someone a link is useless without their cooperation.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../env";
import { defineRoute, type AppEnv } from "../../shared/context";
import { errorResponses, StatusError } from "../../shared/errors";
import { jsonResponse, queryArray } from "../../shared/openapi";
import { AddressType, ChainIdType } from "../../shared/validation/address";
import { canonicalAddress, parseChain, type Chain } from "./chains";
import {
  CODE_PATTERN,
  completionCode,
  normalizeCode,
  randomToken,
  sha256,
} from "./crypto";
import { newNonce, typedDataFor, type MessageParams } from "./messages";
import {
  identityErrors,
  LinkCompleteRequestType,
  LinkCompleteResponseType,
  LinkIdType,
  linkErrors,
  LinkStartRequestType,
  LinkStartResponseType,
  LinkStatusType,
  LookupResponseType,
  UnlinkMessageRequestType,
  UnlinkMessageResponseType,
  UnlinkRequestType,
  UnlinkResponseType,
} from "./schemas";
import {
  consumeNonce,
  createAttempt,
  createNonce,
  getAttempt,
  getNonce,
  lookupLinks,
  MAX_CODE_FAILURES,
  NAMESPACE_SCOPE,
  recordCodeFailure,
  recordXResult,
  removeLinks,
  takeAttemptByState,
  writeLink,
  type AttemptRow,
  type LinkRow,
} from "./store";
import { verifySignature, type Signature } from "./verify";
import { authorizationUrl, verifiedXAccount, xConfigured } from "./x";
import { callbackPage, returnUrl, validReturnTo } from "./callback";

/** Paths under this prefix are never edge-cached (see src/worker.ts). */
export const UNCACHED_IDENTITY_PREFIX = "/v1/identity/x/";

export const LINK_TTL_SECONDS = 600;
export const LOOKUP_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=30";
const NO_STORE = { "cache-control": "no-store" };
const MAX_LOOKUP_ADDRESSES = 100;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

type Ctx = Context<AppEnv>;

function database(env: Env): D1Database {
  if (!env.IDENTITY_DB) {
    throw new StatusError(503, "X linking is not enabled on this deployment");
  }
  return env.IDENTITY_DB;
}

function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

async function limit(c: Ctx, chain?: Chain, address?: string) {
  const allowed = { success: true };
  const checks = [
    c.env.IDENTITY_IP_LIMITER?.limit({ key: clientIp(c) }) ??
      Promise.resolve(allowed),
  ];
  if (chain && address) {
    checks.push(
      c.env.IDENTITY_ADDRESS_LIMITER?.limit({
        key: `${chain.namespace}:${address}`,
      }) ?? Promise.resolve(allowed),
    );
  }
  const outcomes = await Promise.all(checks);
  if (outcomes.some((outcome) => !outcome.success)) {
    throw new StatusError(429, "Too many requests; wait a minute and retry");
  }
}

function target(chainId: string | number, address: string) {
  const chain = parseChain(String(chainId));
  return { chain, address: canonicalAddress(chain.namespace, address) };
}

function identityOf(row: LinkRow) {
  return {
    x_user_id: row.x_user_id,
    x_handle: row.x_handle,
    x_url: `https://x.com/i/user/${row.x_user_id}`,
    linked_at: iso(row.linked_at),
    scope:
      row.chain_scope === NAMESPACE_SCOPE
        ? ("namespace" as const)
        : ("chain" as const),
    verified_chain_id: row.verified_chain_id,
    signature_kind: row.signature_kind,
  };
}

function linkParams(attempt: AttemptRow): MessageParams {
  return {
    namespace: attempt.namespace,
    chainId: attempt.chain_id,
    address: attempt.address,
    nonce: attempt.nonce!,
    issuedAt: attempt.issued_at!,
    expiresAt: attempt.expires_at,
    content: {
      kind: "link",
      xUserId: attempt.x_user_id!,
      xHandle: attempt.x_handle!,
    },
  };
}

async function findAttempt(db: D1Database, linkId: string) {
  const attempt = await getAttempt(db, await sha256(linkId), nowSeconds());
  if (!attempt) {
    throw new StatusError(404, "Link not found or expired; start again");
  }
  return attempt;
}

async function checkCode(db: D1Database, attempt: AttemptRow, code: string) {
  const normalized = normalizeCode(code);
  if (
    CODE_PATTERN.test(normalized) &&
    (await sha256(normalized)) === attempt.code_hash
  ) {
    return;
  }
  await recordCodeFailure(db, attempt.id_hash);
  const left = MAX_CODE_FAILURES - attempt.code_failures - 1;
  throw new StatusError(
    403,
    left > 0
      ? `The code is wrong; ${left} ${left === 1 ? "try" : "tries"} left`
      : "The code is wrong; this link is discarded, start again",
  );
}

export const StartXLink = defineRoute(
  createRoute({
    method: "post",
    path: "/v1/identity/x/link/start",
    tags: ["Identity"],
    summary: "Start linking an X account",
    description:
      "Starts linking an X account to a wallet address. Returns the x.com authorization URL for the person to open and a private link ID. Linking is public: once linked, anyone can see the address's X handle. Then: GET /v1/identity/x/link/{link_id} with the code from X, sign typed_data, POST .../complete. Expires in 10 minutes",
    operationId: "post_StartXLink",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: LinkStartRequestType } },
      },
    },
    responses: {
      200: jsonResponse("Link started", LinkStartResponseType),
      ...errorResponses,
      ...identityErrors,
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = database(c.env);
    if (!xConfigured(c.env)) {
      throw new StatusError(503, "Sign in with X is not configured here");
    }
    const { chain, address } = target(body.chain_id, body.address);
    const returnTo = body.return_to ?? null;
    if (returnTo !== null && !validReturnTo(c.env, returnTo)) {
      throw new StatusError(400, "return_to is not an allowed Ekubo page");
    }
    await limit(c, chain, address);

    const linkId = randomToken();
    const state = randomToken();
    const verifier = randomToken(48);
    const now = nowSeconds();
    await createAttempt(db, {
      idHash: await sha256(linkId),
      stateHash: await sha256(state),
      verifier,
      namespace: chain.namespace,
      address,
      chainId: chain.id,
      returnTo,
      now,
      expiresAt: now + LINK_TTL_SECONDS,
    });
    return c.json(
      {
        link_id: linkId,
        authorization_url: await authorizationUrl(c.env, state, verifier),
        expires_at: iso(now + LINK_TTL_SECONDS),
      },
      200,
      NO_STORE,
    );
  },
);

async function attemptForState(db: D1Database, state: string | undefined) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  return takeAttemptByState(db, await sha256(state), nowSeconds());
}

async function finishCallback(
  env: Env,
  attempt: NonNullable<Awaited<ReturnType<typeof takeAttemptByState>>>,
  code: string,
) {
  const account = await verifiedXAccount(env, code, attempt.verifier).catch(
    () => null,
  );
  if (!account) return null;
  const now = nowSeconds();
  const completion = completionCode();
  await recordXResult(database(env), {
    idHash: attempt.id_hash,
    namespace: attempt.namespace,
    address: attempt.address,
    chainId: attempt.chain_id,
    xUserId: account.id,
    xHandle: account.username,
    codeHash: await sha256(completion),
    nonce: newNonce(attempt.namespace),
    issuedAt: now,
    expiresAt: now + LINK_TTL_SECONDS,
  });
  return { account, completion };
}

export const XLinkCallback = defineRoute(
  createRoute({
    method: "get",
    path: "/v1/identity/x/callback",
    tags: ["Identity"],
    summary: "X authorization callback",
    description:
      "Where x.com sends the browser after approval. Records the verified X account against the link but never links on its own: it shows the completion code, or redirects to return_to with it",
    operationId: "get_XLinkCallback",
    request: {
      query: z.object({
        state: z.string().max(128).optional(),
        code: z.string().max(512).optional(),
        error: z.string().max(256).optional(),
      }),
    },
    responses: {
      200: {
        description: "Page showing the completion code",
        content: { "text/html": { schema: z.string() } },
      },
      302: { description: "Redirect to return_to" },
      400: {
        description: "The link expired or was already used",
        content: { "text/html": { schema: z.string() } },
      },
    },
  }),
  async (c) => {
    const { state, code } = c.req.valid("query");
    const db = database(c.env);
    await limit(c);
    const attempt = await attemptForState(db, state);
    if (!attempt) return callbackPage(c, { outcome: "expired" });
    const result = code ? await finishCallback(c.env, attempt, code) : null;
    const outcome = !code ? "cancelled" : result ? "complete" : "failed";
    if (attempt.return_to) {
      return c.redirect(
        returnUrl(attempt.return_to, outcome, result?.completion),
        302,
      );
    }
    return callbackPage(c, {
      outcome,
      code: result?.completion,
      handle: result?.account.username,
      address: attempt.address,
      chainId: attempt.chain_id,
    });
  },
);

export const GetXLink = defineRoute(
  createRoute({
    method: "get",
    path: "/v1/identity/x/link/{link_id}",
    tags: ["Identity"],
    summary: "Get a link in progress and the message to sign",
    description:
      "Status of a link. Once the person has approved on X, pass the completion code to get the verified X account and typed_data: the exact message the wallet at address must sign, unchanged. Five wrong codes discard the link",
    operationId: "get_GetXLink",
    request: {
      params: z.object({ link_id: LinkIdType }),
      query: z.object({ code: z.string().max(32).optional() }),
    },
    responses: {
      200: jsonResponse("The link", LinkStatusType),
      ...errorResponses,
      ...linkErrors,
    },
  }),
  async (c) => {
    const { link_id } = c.req.valid("param");
    const { code } = c.req.valid("query");
    const db = database(c.env);
    await limit(c);
    const attempt = await findAttempt(db, link_id);
    const approved = attempt.x_user_id !== null;
    const reveal = approved && code !== undefined;
    if (reveal) await checkCode(db, attempt, code);
    return c.json(
      {
        link_id,
        status: approved
          ? ("awaiting_signature" as const)
          : ("awaiting_x" as const),
        chain_id: attempt.chain_id,
        address: attempt.address,
        expires_at: iso(attempt.expires_at),
        x_user_id: reveal ? attempt.x_user_id : null,
        x_handle: reveal ? attempt.x_handle : null,
        typed_data: reveal ? typedDataFor(linkParams(attempt)) : null,
      },
      200,
      NO_STORE,
    );
  },
);

async function provenScope(
  env: Env,
  params: MessageParams,
  signature: Signature,
): Promise<{ scope: string; kind: LinkRow["signature_kind"] }> {
  const kind = await verifySignature(env, params, signature);
  if (kind === null) {
    throw new StatusError(
      401,
      `The signature is not a valid signature by ${params.address} on chain ${params.chainId} over this message`,
    );
  }
  return {
    kind,
    // Only the address's own key proves control on every chain: a contract
    // account at the same address elsewhere may have another owner.
    scope: kind === "ecdsa" ? NAMESPACE_SCOPE : params.chainId,
  };
}

function nonceOf(params: MessageParams, purpose: "link" | "unlink") {
  return {
    nonce: params.nonce,
    purpose,
    namespace: params.namespace,
    address: params.address,
    chainId: params.chainId,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
  };
}

export const CompleteXLink = defineRoute(
  createRoute({
    method: "post",
    path: "/v1/identity/x/link/{link_id}/complete",
    tags: ["Identity"],
    summary: "Complete a link with the wallet signature",
    description:
      "Verifies the wallet's signature over typed_data and links the address to the X account. An ECDSA signature links the address on every chain of its namespace; a contract-account signature (ERC-1271, ERC-6492, Starknet) only on the chain it was verified on. Relinking replaces the previous link, which is kept in history",
    operationId: "post_CompleteXLink",
    request: {
      params: z.object({ link_id: LinkIdType }),
      body: {
        required: true,
        content: { "application/json": { schema: LinkCompleteRequestType } },
      },
    },
    responses: {
      200: jsonResponse("Linked", LinkCompleteResponseType),
      ...errorResponses,
      ...linkErrors,
    },
  }),
  async (c) => {
    const { link_id } = c.req.valid("param");
    const { code, signature } = c.req.valid("json");
    const db = database(c.env);
    const attempt = await findAttempt(db, link_id);
    await limit(c, parseChain(attempt.chain_id), attempt.address);
    if (attempt.x_user_id === null) {
      throw new StatusError(409, "The person has not approved on X yet");
    }
    await checkCode(db, attempt, code);
    const params = linkParams(attempt);
    const { kind, scope } = await provenScope(c.env, params, signature);
    const now = nowSeconds();
    if (!(await consumeNonce(db, nonceOf(params, "link"), now))) {
      throw new StatusError(409, "This message was already used; start again");
    }
    const link: LinkRow = {
      namespace: attempt.namespace,
      address: attempt.address,
      chain_scope: scope,
      x_user_id: attempt.x_user_id,
      x_handle: attempt.x_handle!,
      signature_kind: kind,
      verified_chain_id: attempt.chain_id,
      linked_at: now,
    };
    await writeLink(db, link, attempt.id_hash);
    return c.json(
      {
        chain_id: attempt.chain_id,
        address: attempt.address,
        identity: identityOf(link),
      },
      200,
      NO_STORE,
    );
  },
);

export const GetXUnlinkMessage = defineRoute(
  createRoute({
    method: "post",
    path: "/v1/identity/x/unlink/message",
    tags: ["Identity"],
    summary: "Get the message to sign to unlink",
    description:
      "Returns typed_data for the wallet to sign to remove its X link, then DELETE /v1/identity/x/link. Expires in 10 minutes",
    operationId: "post_GetXUnlinkMessage",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: UnlinkMessageRequestType } },
      },
    },
    responses: {
      200: jsonResponse("The message", UnlinkMessageResponseType),
      ...errorResponses,
      ...linkErrors,
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = database(c.env);
    const { chain, address } = target(body.chain_id, body.address);
    await limit(c, chain, address);
    const links = await lookupLinks(db, chain.namespace, chain.id, [address]);
    if (!links.has(address)) {
      throw new StatusError(404, "This address has no X link on this chain");
    }
    const now = nowSeconds();
    const params: MessageParams = {
      namespace: chain.namespace,
      chainId: chain.id,
      address,
      nonce: newNonce(chain.namespace),
      issuedAt: now,
      expiresAt: now + LINK_TTL_SECONDS,
      content: { kind: "unlink" },
    };
    await createNonce(db, nonceOf(params, "unlink"));
    return c.json(
      {
        nonce: params.nonce,
        expires_at: iso(params.expiresAt),
        typed_data: typedDataFor(params),
      },
      200,
      NO_STORE,
    );
  },
);

export const DeleteXLink = defineRoute(
  createRoute({
    method: "delete",
    path: "/v1/identity/x/link",
    tags: ["Identity"],
    summary: "Unlink with a wallet signature",
    description:
      "Removes the address's X link, proven by a signature over the unlink message. An ECDSA signature removes every link of the address; a contract-account signature only the link on its chain",
    operationId: "delete_DeleteXLink",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: UnlinkRequestType } },
      },
    },
    responses: {
      200: jsonResponse("Unlinked", UnlinkResponseType),
      ...errorResponses,
      ...linkErrors,
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = database(c.env);
    const { chain, address } = target(body.chain_id, body.address);
    await limit(c, chain, address);
    const now = nowSeconds();
    const nonce = await getNonce(db, body.nonce, now);
    if (
      !nonce ||
      nonce.purpose !== "unlink" ||
      nonce.address !== address ||
      nonce.chain_id !== chain.id
    ) {
      throw new StatusError(409, "Unknown, used or expired nonce; start again");
    }
    const params: MessageParams = {
      namespace: chain.namespace,
      chainId: chain.id,
      address,
      nonce: nonce.nonce,
      issuedAt: nonce.issued_at,
      expiresAt: nonce.expires_at,
      content: { kind: "unlink" },
    };
    const { scope } = await provenScope(c.env, params, body.signature);
    if (!(await consumeNonce(db, nonceOf(params, "unlink"), now))) {
      throw new StatusError(409, "This message was already used; start again");
    }
    const removed = await removeLinks(db, chain.namespace, address, scope, now);
    return c.json({ removed }, 200, NO_STORE);
  },
);

export const LookupXIdentities = defineRoute(
  createRoute({
    method: "get",
    path: "/v1/identity/addresses",
    tags: ["Identity"],
    summary: "Look up linked X accounts",
    description:
      "Linked X accounts for up to 100 addresses on one chain. Repeat address. Cached for 30 seconds",
    operationId: "get_LookupXIdentities",
    request: {
      query: z.object({
        chainId: ChainIdType,
        address: queryArray(AddressType).describe(
          "Repeat for each address (?address=0x...&address=0x...)",
        ),
      }),
    },
    responses: {
      200: jsonResponse("Linked X accounts", LookupResponseType),
      ...errorResponses,
      ...identityErrors,
    },
  }),
  async (c) => {
    const { chainId, address: addresses } = c.req.valid("query");
    const chain = parseChain(chainId);
    if (addresses.length === 0 || addresses.length > MAX_LOOKUP_ADDRESSES) {
      throw new StatusError(400, "Pass between 1 and 100 address parameters");
    }
    const canonical = [
      ...new Set(addresses.map((a) => canonicalAddress(chain.namespace, a))),
    ];
    const links = await lookupLinks(
      database(c.env),
      chain.namespace,
      chain.id,
      canonical,
    );
    const identities = Object.fromEntries(
      canonical.map((address) => {
        const row = links.get(address);
        return [address, row ? identityOf(row) : null];
      }),
    );
    return c.json({ chain_id: chain.id, identities }, 200, {
      "cache-control": LOOKUP_CACHE_CONTROL,
    });
  },
);

export const identityRoutes = [
  StartXLink,
  XLinkCallback,
  CompleteXLink,
  GetXLink,
  GetXUnlinkMessage,
  DeleteXLink,
  LookupXIdentities,
];
