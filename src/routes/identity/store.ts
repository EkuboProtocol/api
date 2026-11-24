import type { D1Database } from "@cloudflare/workers-types";
import type { Namespace } from "./chains";
import type { SignatureKind } from "./verify";

export const NAMESPACE_SCOPE = "*";
export const MAX_CODE_FAILURES = 5;

export interface LinkRow {
  namespace: Namespace;
  address: string;
  chain_scope: string;
  x_user_id: string;
  x_handle: string;
  signature_kind: SignatureKind;
  verified_chain_id: string;
  linked_at: number;
}

export interface AttemptRow {
  id_hash: string;
  namespace: Namespace;
  address: string;
  chain_id: string;
  return_to: string | null;
  x_user_id: string | null;
  x_handle: string | null;
  code_hash: string | null;
  code_failures: number;
  nonce: string | null;
  issued_at: number | null;
  created_at: number;
  expires_at: number;
}

export interface NewAttempt {
  idHash: string;
  stateHash: string;
  verifier: string;
  namespace: Namespace;
  address: string;
  chainId: string;
  returnTo: string | null;
  now: number;
  expiresAt: number;
}

export async function createAttempt(db: D1Database, attempt: NewAttempt) {
  await db.batch([
    db
      .prepare("DELETE FROM link_attempts WHERE expires_at <= ?")
      .bind(attempt.now),
    db
      .prepare("DELETE FROM nonces WHERE expires_at <= ?")
      .bind(attempt.now - 86_400),
    db
      .prepare(
        `INSERT INTO link_attempts
          (id_hash, state_hash, verifier, namespace, address, chain_id, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        attempt.idHash,
        attempt.stateHash,
        attempt.verifier,
        attempt.namespace,
        attempt.address,
        attempt.chainId,
        attempt.returnTo,
        attempt.now,
        attempt.expiresAt,
      ),
  ]);
}

/**
 * Consumes the OAuth state: a callback is accepted once per attempt.
 * RETURNING yields the updated row, so the verifier is cleared afterwards,
 * by recordXResult, not here.
 */
export async function takeAttemptByState(
  db: D1Database,
  stateHash: string,
  now: number,
) {
  return db
    .prepare(
      `UPDATE link_attempts SET state_hash = NULL
       WHERE state_hash = ? AND verifier IS NOT NULL AND expires_at > ?
       RETURNING id_hash, verifier, namespace, address, chain_id, return_to`,
    )
    .bind(stateHash, now)
    .first<{
      id_hash: string;
      verifier: string;
      namespace: Namespace;
      address: string;
      chain_id: string;
      return_to: string | null;
    }>();
}

export interface XResult {
  idHash: string;
  namespace: Namespace;
  address: string;
  chainId: string;
  xUserId: string;
  xHandle: string;
  codeHash: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

/** Records the verified X account and opens the signing window. */
export async function recordXResult(db: D1Database, result: XResult) {
  await db.batch([
    db
      .prepare(
        `UPDATE link_attempts
         SET verifier = NULL, x_user_id = ?, x_handle = ?, code_hash = ?, nonce = ?, issued_at = ?, expires_at = ?
         WHERE id_hash = ?`,
      )
      .bind(
        result.xUserId,
        result.xHandle,
        result.codeHash,
        result.nonce,
        result.issuedAt,
        result.expiresAt,
        result.idHash,
      ),
    insertNonce(db, {
      nonce: result.nonce,
      purpose: "link",
      namespace: result.namespace,
      address: result.address,
      chainId: result.chainId,
      issuedAt: result.issuedAt,
      expiresAt: result.expiresAt,
    }),
  ]);
}

export async function getAttempt(db: D1Database, idHash: string, now: number) {
  return db
    .prepare(
      `SELECT id_hash, namespace, address, chain_id, return_to, x_user_id, x_handle,
              code_hash, code_failures, nonce, issued_at, created_at, expires_at
       FROM link_attempts WHERE id_hash = ? AND expires_at > ?`,
    )
    .bind(idHash, now)
    .first<AttemptRow>();
}

export type AttemptTable = "link_attempts" | "unlink_attempts";

/** Counts a wrong completion code; the attempt is discarded at the limit. */
export async function recordCodeFailure(
  db: D1Database,
  idHash: string,
  table: AttemptTable = "link_attempts",
) {
  await db.batch([
    db
      .prepare(
        `UPDATE ${table} SET code_failures = code_failures + 1 WHERE id_hash = ?`,
      )
      .bind(idHash),
    db
      .prepare(`DELETE FROM ${table} WHERE id_hash = ? AND code_failures >= ?`)
      .bind(idHash, MAX_CODE_FAILURES),
  ]);
}

export interface NewNonce {
  nonce: string;
  purpose: "link" | "unlink";
  namespace: Namespace;
  address: string;
  chainId: string;
  issuedAt: number;
  expiresAt: number;
}

function insertNonce(db: D1Database, nonce: NewNonce) {
  return db
    .prepare(
      `INSERT INTO nonces (nonce, purpose, namespace, address, chain_id, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      nonce.nonce,
      nonce.purpose,
      nonce.namespace,
      nonce.address,
      nonce.chainId,
      nonce.issuedAt,
      nonce.expiresAt,
    );
}

export async function createNonce(db: D1Database, nonce: NewNonce) {
  await insertNonce(db, nonce).run();
}

export async function getNonce(db: D1Database, nonce: string, now: number) {
  return db
    .prepare(
      `SELECT nonce, purpose, namespace, address, chain_id, issued_at, expires_at
       FROM nonces WHERE nonce = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(nonce, now)
    .first<{
      nonce: string;
      purpose: "link" | "unlink";
      namespace: Namespace;
      address: string;
      chain_id: string;
      issued_at: number;
      expires_at: number;
    }>();
}

/**
 * Marks a nonce used. Returns false if it was already used, has expired or
 * does not belong to this purpose and address: the signature is a replay.
 */
export async function consumeNonce(
  db: D1Database,
  nonce: NewNonce,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE nonces SET used_at = ?
       WHERE nonce = ? AND purpose = ? AND namespace = ? AND address = ? AND chain_id = ?
         AND used_at IS NULL AND expires_at > ?
       RETURNING nonce`,
    )
    .bind(
      now,
      nonce.nonce,
      nonce.purpose,
      nonce.namespace,
      nonce.address,
      nonce.chainId,
      now,
    )
    .first<{ nonce: string }>();
  return row !== null;
}

// Rows a new link at this scope replaces: a namespace link replaces every
// link of the address, a chain link only the one on its chain.
function scopeFilter(scope: string) {
  return scope === NAMESPACE_SCOPE
    ? { sql: "namespace = ? AND address = ?", extra: [] as string[] }
    : {
        sql: "namespace = ? AND address = ? AND chain_scope = ?",
        extra: [scope],
      };
}

function archive(
  db: D1Database,
  namespace: Namespace,
  address: string,
  scope: string,
  now: number,
  reason: "relinked" | "unlinked",
) {
  const filter = scopeFilter(scope);
  const args = [namespace, address, ...filter.extra];
  return [
    db
      .prepare(
        `INSERT INTO link_history
          (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason)
         SELECT namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ?, ?
         FROM links WHERE ${filter.sql}`,
      )
      .bind(now, reason, ...args),
    db.prepare(`DELETE FROM links WHERE ${filter.sql}`).bind(...args),
  ];
}

/** Writes a link, moving whatever it replaces to the history. */
export async function writeLink(
  db: D1Database,
  link: LinkRow,
  attemptIdHash: string,
) {
  await db.batch([
    ...archive(
      db,
      link.namespace,
      link.address,
      link.chain_scope,
      link.linked_at,
      "relinked",
    ),
    db
      .prepare(
        `INSERT INTO links
          (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        link.namespace,
        link.address,
        link.chain_scope,
        link.x_user_id,
        link.x_handle,
        link.signature_kind,
        link.verified_chain_id,
        link.linked_at,
      ),
    db
      .prepare("DELETE FROM link_attempts WHERE id_hash = ?")
      .bind(attemptIdHash),
  ]);
}

/** Removes the links at this scope; returns how many were removed. */
export async function removeLinks(
  db: D1Database,
  namespace: Namespace,
  address: string,
  scope: string,
  now: number,
): Promise<number> {
  const results = await db.batch(
    archive(db, namespace, address, scope, now, "unlinked"),
  );
  return results[1]?.meta.changes ?? 0;
}

/** Whether the address has a link stored at exactly this scope. */
export async function hasLinkAtScope(
  db: D1Database,
  namespace: Namespace,
  address: string,
  scope: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS found FROM links WHERE namespace = ? AND address = ? AND chain_scope = ?",
    )
    .bind(namespace, address, scope)
    .first<{ found: number }>();
  return row !== null;
}

export interface UnlinkAttemptRow {
  id_hash: string;
  return_to: string | null;
  x_user_id: string | null;
  x_handle: string | null;
  code_hash: string | null;
  code_failures: number;
  expires_at: number;
}

export async function createUnlinkAttempt(
  db: D1Database,
  attempt: {
    idHash: string;
    stateHash: string;
    verifier: string;
    returnTo: string | null;
    now: number;
    expiresAt: number;
  },
) {
  await db.batch([
    db
      .prepare("DELETE FROM unlink_attempts WHERE expires_at <= ?")
      .bind(attempt.now),
    db
      .prepare(
        `INSERT INTO unlink_attempts
          (id_hash, state_hash, verifier, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        attempt.idHash,
        attempt.stateHash,
        attempt.verifier,
        attempt.returnTo,
        attempt.now,
        attempt.expiresAt,
      ),
  ]);
}

/** Consumes the OAuth state of an X-side unlink, as takeAttemptByState. */
export async function takeUnlinkAttemptByState(
  db: D1Database,
  stateHash: string,
  now: number,
) {
  return db
    .prepare(
      `UPDATE unlink_attempts SET state_hash = NULL
       WHERE state_hash = ? AND verifier IS NOT NULL AND expires_at > ?
       RETURNING id_hash, verifier, return_to`,
    )
    .bind(stateHash, now)
    .first<{ id_hash: string; verifier: string; return_to: string | null }>();
}

/** Records the verified X account and opens the confirmation window. */
export async function recordUnlinkXResult(
  db: D1Database,
  result: {
    idHash: string;
    xUserId: string;
    xHandle: string;
    codeHash: string;
    expiresAt: number;
  },
) {
  await db
    .prepare(
      `UPDATE unlink_attempts
       SET verifier = NULL, x_user_id = ?, x_handle = ?, code_hash = ?, expires_at = ?
       WHERE id_hash = ?`,
    )
    .bind(
      result.xUserId,
      result.xHandle,
      result.codeHash,
      result.expiresAt,
      result.idHash,
    )
    .run();
}

export async function getUnlinkAttempt(
  db: D1Database,
  idHash: string,
  now: number,
) {
  return db
    .prepare(
      `SELECT id_hash, return_to, x_user_id, x_handle, code_hash, code_failures, expires_at
       FROM unlink_attempts WHERE id_hash = ? AND expires_at > ?`,
    )
    .bind(idHash, now)
    .first<UnlinkAttemptRow>();
}

export type RemovedLink = Pick<
  LinkRow,
  "namespace" | "address" | "chain_scope" | "verified_chain_id"
>;

/**
 * Removes every link to this X account, moving them to the history, and
 * discards links to it still in progress, which would otherwise complete
 * after the owner's unlink. `endReason` is x_unlinked when the owner proved
 * the X account, removed when an operator acted on a report.
 */
export async function removeLinksOfXUser(
  db: D1Database,
  xUserId: string,
  now: number,
  endReason: "x_unlinked" | "removed",
  unlinkAttemptIdHash?: string,
): Promise<RemovedLink[]> {
  const statements = [
    db
      .prepare(
        `INSERT INTO link_history
          (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason)
         SELECT namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ?, ?
         FROM links WHERE x_user_id = ?`,
      )
      .bind(now, endReason, xUserId),
    db
      .prepare(
        `DELETE FROM links WHERE x_user_id = ?
         RETURNING namespace, address, chain_scope, verified_chain_id`,
      )
      .bind(xUserId),
    db.prepare("DELETE FROM link_attempts WHERE x_user_id = ?").bind(xUserId),
  ];
  if (unlinkAttemptIdHash !== undefined) {
    statements.push(
      db
        .prepare("DELETE FROM unlink_attempts WHERE id_hash = ?")
        .bind(unlinkAttemptIdHash),
    );
  }
  const results = await db.batch<RemovedLink>(statements);
  return results[1]?.results ?? [];
}

/** The link that applies to each address on this chain. */
export async function lookupLinks(
  db: D1Database,
  namespace: Namespace,
  chainId: string,
  addresses: readonly string[],
): Promise<Map<string, LinkRow>> {
  const found = new Map<string, LinkRow>();
  if (addresses.length === 0) return found;
  // The addresses go in as one JSON parameter: D1 allows 100 bound
  // parameters per statement, so one per address fails near the cap.
  const { results } = await db
    .prepare(
      `SELECT namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at
       FROM links
       WHERE namespace = ? AND chain_scope IN (?, ?)
         AND address IN (SELECT value FROM json_each(?))`,
    )
    .bind(namespace, NAMESPACE_SCOPE, chainId, JSON.stringify(addresses))
    .all<LinkRow>();
  for (const row of results) {
    // A chain-scoped link overrides the namespace link on its chain.
    if (!found.has(row.address) || row.chain_scope !== NAMESPACE_SCOPE) {
      found.set(row.address, row);
    }
  }
  return found;
}
