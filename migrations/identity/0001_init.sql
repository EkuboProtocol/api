-- Wallet to X account links (EKU-3113). Dedicated to identity: this database
-- is not the indexer's and not the token chat's.
--
-- Addresses are stored canonical: EVM as 0x + 40 lowercase hex, Starknet as
-- 0x + 64 lowercase hex. chain_scope is '*' when the link holds on every chain
-- of the namespace (an ECDSA signature by the address's own key) and the
-- decimal chain ID when it holds only on the chain the contract account's
-- signature was verified on (ERC-1271, ERC-6492, Starknet accounts).

-- One address links at most one X account per scope. A chain-scoped row takes
-- precedence over the namespace row on its chain.
CREATE TABLE links (
  namespace TEXT NOT NULL CHECK (namespace IN ('evm', 'starknet')),
  address TEXT NOT NULL,
  chain_scope TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  signature_kind TEXT NOT NULL CHECK (
    signature_kind IN ('ecdsa', 'erc1271', 'erc6492', 'starknet')
  ),
  verified_chain_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, address, chain_scope)
);

CREATE INDEX links_by_x_user ON links (x_user_id);

-- Every link that was replaced by a relink or removed by an unlink.
CREATE TABLE link_history (
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
  end_reason TEXT NOT NULL CHECK (end_reason IN ('relinked', 'unlinked'))
);

CREATE INDEX link_history_by_address ON link_history (namespace, address);

-- A link in progress. The caller that started it holds the link ID (stored
-- hashed). The X callback never links: it records the verified X account and
-- hands a completion code (stored hashed) only to the browser that approved
-- on X. Reading the message and completing need both.
CREATE TABLE link_attempts (
  id_hash TEXT PRIMARY KEY,
  state_hash TEXT UNIQUE,
  verifier TEXT,
  namespace TEXT NOT NULL,
  address TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  return_to TEXT,
  x_user_id TEXT,
  x_handle TEXT,
  code_hash TEXT,
  code_failures INTEGER NOT NULL DEFAULT 0,
  nonce TEXT,
  issued_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX link_attempts_by_expiry ON link_attempts (expires_at);

-- Signed-message nonces, for links and unlinks. Each is used at most once and
-- only before it expires.
CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('link', 'unlink')),
  namespace TEXT NOT NULL,
  address TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX nonces_by_expiry ON nonces (expires_at);
