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
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../env";
import { defineRoute } from "../../shared/context";
import { errorResponses, StatusError } from "../../shared/errors";
import { jsonResponse, queryArray } from "../../shared/openapi";
import { AddressType, ChainIdType } from "../../shared/validation/address";
import { canonicalAddress, parseChain, type Chain } from "./chains";
import {
  checkCode,
  iso,
  limit,
  LINK_TTL_SECONDS,
  NO_STORE,
  nowSeconds,
  type Ctx,
} from "./common";
import { completionCode, randomToken, sha256 } from "./crypto";
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
  hasLinkAtScope,
  lookupLinks,
  NAMESPACE_SCOPE,
  recordXResult,
  removeLinks,
  takeAttemptByState,
  writeLink,
  type AttemptRow,
  type LinkRow,
} from "./store";
import { verifySignature, type Signature } from "./verify";
import { authorizationUrl, verifiedXAccount } from "./x";
import { callbackPage, returnUrl, validReturnTo } from "./callback";
import { CompleteXUnlink, StartXUnlink, unlinkCallback } from "./xUnlink";

/** Paths under this prefix are never edge-cached (see src/worker.ts). */
export const UNCACHED_IDENTITY_PREFIX = "/v1/identity/x/";

export { LINK_TTL_SECONDS } from "./common";
export const LOOKUP_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=30";
const MAX_LOOKUP_ADDRESSES = 100;

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
    const db = c.env.IDENTITY_DB;
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

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
  await recordXResult(env.IDENTITY_DB, {
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

async function linkCallback(
  c: Ctx,
  attempt: NonNullable<Awaited<ReturnType<typeof takeAttemptByState>>>,
  code: string | undefined,
) {
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
}

export const XLinkCallback = defineRoute(
  createRoute({
    method: "get",
    path: "/v1/identity/x/callback",
    tags: ["Identity"],
    summary: "X authorization callback",
    description:
      "Where x.com sends the browser after approval, for links and X-side unlinks. Records the verified X account against the attempt but never links or unlinks on its own: it shows the completion code, or redirects to return_to with it",
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
    const db = c.env.IDENTITY_DB;
    await limit(c);
    if (!state || !STATE_PATTERN.test(state)) {
      return callbackPage(c, { outcome: "expired" });
    }
    const stateHash = await sha256(state);
    const attempt = await takeAttemptByState(db, stateHash, nowSeconds());
    if (attempt) return linkCallback(c, attempt, code);
    const unlink = await unlinkCallback(c, db, stateHash, code);
    return unlink ?? callbackPage(c, { outcome: "expired" });
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
    const db = c.env.IDENTITY_DB;
    await limit(c);
    const attempt = await findAttempt(db, link_id);
    const approved = attempt.x_user_id !== null;
    const reveal = approved && code !== undefined;
    if (reveal) await checkCode(db, "link_attempts", attempt, code);
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
    const db = c.env.IDENTITY_DB;
    const attempt = await findAttempt(db, link_id);
    await limit(c, parseChain(attempt.chain_id), attempt.address);
    if (attempt.x_user_id === null) {
      throw new StatusError(409, "The person has not approved on X yet");
    }
    await checkCode(db, "link_attempts", attempt, code);
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
    const db = c.env.IDENTITY_DB;
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
      "Removes the address's X link, proven by a signature over the unlink message. An ECDSA signature removes every link of the address; a contract-account signature only the link made on its chain, and is refused with 409 (the nonce stays usable) when the address's link there is its all-chain ECDSA link",
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
    const db = c.env.IDENTITY_DB;
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
    if (
      scope !== NAMESPACE_SCOPE &&
      !(await hasLinkAtScope(db, chain.namespace, address, scope))
    ) {
      // The link on this chain is the address's all-chain link, made with
      // its own key. A contract signature proves control on this chain only,
      // so it cannot remove a link that holds on every chain.
      throw new StatusError(
        409,
        "This address is linked on every chain with its own key; a contract-account signature only removes a link made on its chain. Sign the unlink message with the address's key, or unlink from the X side",
      );
    }
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
    return c.json(
      await identitiesOf(c.env.IDENTITY_DB, chain, addresses),
      200,
      {
        "cache-control": LOOKUP_CACHE_CONTROL,
      },
    );
  },
);

async function identitiesOf(db: D1Database, chain: Chain, addresses: string[]) {
  const canonical = [
    ...new Set(addresses.map((a) => canonicalAddress(chain.namespace, a))),
  ];
  const links = await lookupLinks(db, chain.namespace, chain.id, canonical);
  const identities = Object.fromEntries(
    canonical.map((address) => {
      const row = links.get(address);
      return [address, row ? identityOf(row) : null];
    }),
  );
  return { chain_id: chain.id, identities };
}

export const LookupOwnXIdentity = defineRoute(
  createRoute({
    method: "get",
    path: "/v1/identity/x/address",
    tags: ["Identity"],
    summary: "Look up one address's X account, uncached",
    description:
      "The linked X account of one address, read fresh and never cached. For a wallet showing its own link right after linking or unlinking; use GET /v1/identity/addresses for everyone else",
    operationId: "get_LookupOwnXIdentity",
    request: {
      query: z.object({ chainId: ChainIdType, address: AddressType }),
    },
    responses: {
      200: jsonResponse("Linked X account", LookupResponseType),
      ...errorResponses,
      ...identityErrors,
    },
  }),
  async (c) => {
    const { chainId, address } = c.req.valid("query");
    const chain = parseChain(chainId);
    await limit(c);
    return c.json(
      await identitiesOf(c.env.IDENTITY_DB, chain, [address]),
      200,
      NO_STORE,
    );
  },
);

export const identityRoutes = [
  StartXLink,
  XLinkCallback,
  CompleteXLink,
  GetXLink,
  GetXUnlinkMessage,
  DeleteXLink,
  StartXUnlink,
  CompleteXUnlink,
  LookupXIdentities,
  LookupOwnXIdentity,
];
