# Zero-seed launch reads (draft/local)

Draft response contract: `zero-seed-launch-api/v2` (v1 plus
`fee_schedule.decay_factor`, for the draft exponential creator-fee decay of
evm-contracts `b1cbb1c1a9a00de62072a63a8f4aab4d97065573`). Behavioral policy:
`zero-seed-launch-draft-policy/v2`. Indexer source:
`cdf58fcfca963aa3eaaaa5d388578ddf81739459`. Live instance lists are empty.

`fee_schedule.fee_rate` is the contract's `feeAt` at the indexed block time:
`initial_fee` until `trading_start`, then
`final_fee + floor((initial_fee - final_fee) * (b^t - b^D) / (2^64 - b^D))` with
`b^n` the contract's `powQ64` (square-and-multiply, floor after every Q0.64
multiply), then `final_fee` from `fee_end`. `decay_factor` is a literal Q0.64
per-second multiplier, not a half-life; do not assume a linear schedule.

## Requests

- `GET /launches?chainId=31337&limit=50&before_event_id=...&creator=0x...`
- `GET /launches/{chainId}/{poolId}`
- `GET /launches/{chainId}/{poolId}/swaps?limit=50&after_event_id=...`
- `GET /launches/{chainId}/{poolId}/claims?limit=50&after_event_id=...`

One chain per list request gives an unambiguous indexed `as_of`. Pool IDs are
32-byte hex. Cursors are signed decimal event IDs: newest-first creations use
`before_event_id`; oldest-first swaps/claims use `after_event_id`. Limits are
1–200. A non-null `next_cursor` means another row was observed in that snapshot.
Cursor continuation is not a frozen historical snapshot: reorgs may change pages.

No stats, lifecycle status, staged funding, advances, terminal migration, user
counts or connected-wallet analytics exist. Forwarding lockers are contracts,
not traders. Fee phases are schedule labels, not completion/exhaustion states.

## Supported instances and consistency

All hosted query delegates construct a reader with **no enabled instances**.
They refuse launch reads with 404 without querying Postgres; missing database
configuration also returns 404. There is no environment-binding enable switch.
Only the explicit local test harness can pass the full reviewed instance
manifest. Constructor quote, Core, executed runtime, WETH runtime and ABI must
match together; synthetic 6-decimal fixtures and template runtimes are refused.

List SQL screens the extension, quote, Core, ordered pair, zero Core fee and
spacing before pagination. Detail and both histories use that same selection.
Missing/unsupported launches return 404. A missing, mismatched or stale cursor
head returns 503. Parameters return 400; malformed internal indexed output
fails as 500, never a success or client-validation fallback.

Each read uses one read-only repeatable-read transaction for the coherent head,
configuration, current Core balance, creator ledger and event page. Responses
are `no-store`. Local test freshness is 60 seconds from cursor `last_updated`;
this is not an approved live/hosted parameter. Fee rates and phases depend only
on the indexed block timestamp. HTTP does not accept a wall-clock fee override.

Principal is the immutable installed supply/L pair and Core event-accounted pool
reserves (including rounding dust). Creator accrued/claimed/unclaimed ledgers
are separate, per asset. Upper-bound leftover token residue and Core unowned
token/quote dust are different quantities; no shared <=90 bound or fabricated
claimable-funds estimate is exposed. Both assets are claimed atomically in full.

Requested supply and build/expiry times are not all emitted onchain. The API
must not fabricate them. Producer/owner surfaces separately bind a single
preview's requested→actual supply/L, 31 UTF-8 byte metadata, all calldata and
exact sink/start/expiry constraints. This read API does not close L-3 end-to-end.

## Local verification and stop/reset

Run `bun test src/routes/launches src/responseSchemas.test.ts
src/openapiSnapshot.test.ts`, `bun run lint`, and `bunx tsc --noEmit`.

For actual emitted-state/Postgres/handler replay, provide the exact pinned
indexer checkout, a disposable loopback Postgres 18, and the run scratch path:

```sh
ZERO_SEED_INDEXER_WORKTREE=/path/to/pinned/indexer \
TEST_PG_CONNECTION_STRING=postgres://fixture:fixture@127.0.0.1:55453/postgres \
PAPERCLIP_RUN_SCRATCH_DIR=/path/to/run-scratch \
LAUNCH_GOLDEN_DIR=/path/to/run-scratch \
bun scripts/verifyLaunchReplay.ts
```

The runner checks source/fixture pins, creates a scratch copy of the reviewed
indexer test harness, appends API tests, and executes actual stream/DAO/SQL
replay without editing the indexer checkout. Test-only query-method spies wire
the actual HTTP handlers to real local SQL with the reviewed local manifest;
they do not stub response rows. All temporary databases are dropped by the
harness. No RPC, fork URL, provider/secret read or production migration is used.

Safe stop is launch support OFF. A pre-issuance source rollback to the PR base
without launch routes is safe; the old staged or arbitrary-quote drafts are
not. Reset only the dedicated disposable local test databases/container.
Application rollback cannot refund, withdraw, rebalance or migrate immutable
principal. No merge/deploy/live issuance or authority change is authorized.

Live provenance/registration/state, production query performance/capacity/costs,
served artifacts, mined UserOps, full WETH metadata reproduction, downstream
whole-stack QA/Sage, external audit and legal/provider/wallet/board/release
controls remain NOT PROVEN/HOLD.
