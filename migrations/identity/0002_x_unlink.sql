-- Unlinking from the X side: the owner of an X account removes every link to
-- it by signing in with X again, without any wallet. An operator can also
-- remove links on a report (see src/routes/identity/OPERATIONS.md).

-- An X-side unlink in progress. Same rules as link_attempts: the caller holds
-- the unlink ID (stored hashed), the OAuth state is single use, the PKCE
-- verifier is cleared once X answers, and nothing is removed until the
-- completion code shown to the browser that approved on X is given back.
CREATE TABLE unlink_attempts (
  id_hash TEXT PRIMARY KEY,
  state_hash TEXT UNIQUE,
  verifier TEXT,
  return_to TEXT,
  x_user_id TEXT,
  x_handle TEXT,
  code_hash TEXT,
  code_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX unlink_attempts_by_expiry ON unlink_attempts (expires_at);

-- New end reasons: x_unlinked (by the X account's owner) and removed (by an
-- operator). SQLite cannot change a CHECK constraint, so the table is rebuilt.
CREATE TABLE link_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  address TEXT NOT NULL,
  chain_scope TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  signature_kind TEXT NOT NULL,
  verified_chain_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  end_reason TEXT NOT NULL CHECK (
    end_reason IN ('relinked', 'unlinked', 'x_unlinked', 'removed')
  )
);

INSERT INTO link_history_new
  (id, namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason)
SELECT id, namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason
FROM link_history;

DROP TABLE link_history;

ALTER TABLE link_history_new RENAME TO link_history;

CREATE INDEX link_history_by_address ON link_history (namespace, address);

CREATE INDEX link_history_by_x_user ON link_history (x_user_id);
