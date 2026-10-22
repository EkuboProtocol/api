# Zero-seed launch reads (draft/local)

Draft response contract: `zero-seed-launch-api/v4`, for the forward-only
`ZeroSeedLaunch` and its separate `ZeroSeedLaunchPeriphery` of evm-contracts
`550afc40280423128c02eb5ffd213aa959b34e2a` (ABI sha256 of `jq -cS .abi`:
ZeroSeedLaunch `efae9388aa6b1342479204ddf436fd2a310df16bf06c80c990b2d22c90d1e41e`,
periphery `df24d9f07d45323da7e46c0f6e64ce24f8f522442d60cb07880ddf742ebe7305`).
Indexer schema `zero-seed-launch-index/v3` (migration 00139). Live instance
and quote lists are empty.

Changes from v3:

- Every `LaunchSummary` (list and detail) has
  `supply: { requested, installed, sink, sink_holder }`, decimal strings of
  raw launch-token units. `requested` is `LaunchParameters.supply` as
  submitted and the token's `totalSupply`; `installed` is what Core took into
  the position at creation (the launch-token delta of Core's
  `PositionUpdated`), all of the circulating inventory; `sink` is
  `requested - installed`, minted to `sink_holder` (address 0) and never
  spendable. It is not a burn: `totalSupply` stays `requested`. The API
  refuses (500) indexed rows outside `0 < installed <= requested` or with
  `sink != requested - installed`.
- `principal.installed_supply` is removed (use `supply.installed`);
  `principal.liquidity` is the liquidity the extension computed and
  installed.
- The quote is per launch (`LaunchParameters.quoteToken`): one extension and
  periphery serve native ETH and ERC-20 quotes. `quote_token` is the launch's
  own quote; an instance has no quote. Native ETH is address 0, always token0
  (the launch token is token1), 18 decimals, null name and symbol. An ERC-20
  quote above the launch token's address makes the launch token token0.

Creator fees span the whole uint64 range. `initial_fee`, `final_fee` and
both `fee_rate`s are Q0.64 rates as canonical decimal strings from `0` to
`18446744073709551615` (2^64 - 1, the maximum, just under 100%; the fee
fraction is value / 2^64, never exactly 100%), never JSON numbers. The
contract checks only `final_fee <= initial_fee` and a nonzero duration; there
is no ceiling below 2^64 - 1 and no `FeeTooHigh` error. The API refuses (500) an
indexed fee above 2^64 - 1 instead of wrapping, truncating or serving it.
The response shape is unchanged, so the contract stays v4.

Unchanged from v3: the fixed-base fee table (`fee_schedule.decay` is
`{ kind: "fixed_base_q128", half_life_seconds: 600 }` and `fee_rate` the
contract's `feeAt` at the indexed block time, checked in `policy.test.ts`
against all 25,212 rows of the protocol's independent all-second vectors),
`creator` (owner at creation, never changes) versus `owner` (current,
transferable holder of unclaimed and future fees) and `controller` (the
periphery), periphery claim payouts linked by `ledger_event_id` and counted
once, and the `/owners` history and `owner`/`creator` list filters.

`fixtures/zero-seed-launch-api-v4.golden.json` is a machine-readable example of
every response, written by the actual handlers over the replayed local fixture:
a native-ETH (launch token1, sink 578) and two ERC-20 (launch token0, sink 790)
launches on one extension, ownership transfers, claims, swaps and a reorg,
plus two launches created at the maximum rate: `maxNativeDetail` (native,
2^64 - 1 decaying to 0.3% over 3600 s) and `maxErc20Detail` (ERC-20, flat at
2^64 - 1), with their exact-input, exact-output and decayed swaps and claims.

## Requests

- `GET /launches?chainId=31337&limit=50&before_event_id=...&creator=0x...&owner=0x...`
- `GET /launches/{chainId}/{poolId}`
- `GET /launches/{chainId}/{poolId}/swaps?limit=50&after_event_id=...`
- `GET /launches/{chainId}/{poolId}/claims?limit=50&after_event_id=...`
- `GET /launches/{chainId}/{poolId}/owners?limit=50&after_event_id=...`

One chain per list request gives an unambiguous indexed `as_of`. Pool IDs are
32-byte hex. Cursors are signed decimal event IDs: newest-first creations use
`before_event_id`; oldest-first swaps/claims/owners use `after_event_id`.
Limits are 1–200. A non-null `next_cursor` means another row was observed in
that snapshot. Cursor continuation is not a frozen historical snapshot: reorgs
may change pages.

No stats, lifecycle status, staged funding, advances, terminal migration, user
counts or connected-wallet analytics exist. Forwarding lockers are contracts,
not traders. Fee phases are schedule labels, not completion/exhaustion states.

## Supported instances and consistency

All hosted query delegates construct a reader with **no enabled instances**.
They refuse launch reads with 404 without querying Postgres; missing database
configuration also returns 404. There is no environment-binding enable switch.
Only the explicit local test harness can pass the full reviewed instance
manifest and quote list. Extension and periphery addresses and runtimes, Core
and both ABIs must match an instance together. Quote support is per launch:
native ETH is always eligible; an ERC-20 quote only if it is in the reviewed
quote list by chain, address and runtime codehash. The local list holds only
the fixture's plain test ERC-20 (evm-contracts `test/TestToken.sol`,
relocated to `0xff…ff`); the hosted list is empty, so no ERC-20 quote launch
can be served there even if launch reads were enabled.

List SQL screens the extension, controller (periphery), Core, the launch's own
quote and kind against the supported quote list, ordered pair, zero Core fee
and spacing before pagination, so an unsupported quote never occupies a page.
Detail and all histories use that same selection: an unsupported launch is 404.
Missing/unsupported launches return 404. A missing, mismatched or stale cursor
head returns 503. Parameters return 400; malformed internal indexed output
fails as 500, never a success or client-validation fallback.

Each read uses one read-only repeatable-read transaction for the coherent head,
configuration, current Core balance, creator ledger and event page. Responses
are `no-store`. Local test freshness is 60 seconds from cursor `last_updated`;
this is not an approved live/hosted parameter. Fee rates and phases depend only
on the indexed block timestamp. HTTP does not accept a wall-clock fee override.

Principal is the immutable installed liquidity and Core event-accounted pool
reserves (including rounding dust). Creator accrued/claimed/unclaimed ledgers
are separate, per asset. Upper-bound leftover token residue and Core unowned
token/quote dust are different quantities; no shared <=90 bound or fabricated
claimable-funds estimate is exposed. Both assets are claimed atomically in full.

The installed supply is not emitted by `LaunchCreated`; the indexer takes it
from Core's position update of the creation and refuses a creation without
exactly one consistent update. Build/expiry times are not emitted onchain and
are not served. Producer/owner surfaces separately bind a preview's
requested supply and computed installation, 31 UTF-8 byte metadata, all
calldata and start/expiry constraints; this read API does not.

## Local verification and stop/reset

Run `bun run format:check`, `bun run lint`, `bun run typecheck` and
`bun test` (or `bun test src/routes/launches src/responseSchemas.test.ts
src/openapiSnapshot.test.ts` for the launch routes). `bun run openapi`
regenerates `openapi.json`.

For actual emitted-state/Postgres/handler replay, provide the exact pinned
indexer checkout (EkuboProtocol/indexer
`c78a48e3aff1df7a8e3298545eee8be04474063d`, fixture
`tests/fixtures/zero-seed-launch/local-chain.json` sha256
`09d7745740af507a02304e26c0e20d6f27b1047fd707c056ef4d936c67a74fcc`), a
disposable loopback Postgres 18 and a scratch directory:

```sh
docker run -d --rm --name launch-replay-pg -p 127.0.0.1:55453:5432 \
  --tmpfs /var/lib/postgresql:rw \
  -e POSTGRES_USER=fixture -e POSTGRES_PASSWORD=fixture postgres:18
ZERO_SEED_INDEXER_WORKTREE=/path/to/pinned/indexer \
TEST_PG_CONNECTION_STRING=postgres://fixture:fixture@127.0.0.1:55453/postgres \
LAUNCH_REPLAY_SCRATCH_DIR=/path/to/scratch \
LAUNCH_GOLDEN_DIR=/path/to/scratch \
bun scripts/verifyLaunchReplay.ts
docker stop launch-replay-pg
```

With `LAUNCH_GOLDEN_DIR` set, the run writes `actual-handler-golden.json`;
copy it to `fixtures/zero-seed-launch-api-v4.golden.json` and run
`bun run format`.

The runner checks source/fixture pins, creates a scratch copy of the reviewed
indexer test harness, appends API tests (`scripts/launchReplayCases.txt`),
and executes actual stream/DAO/SQL replay without editing the indexer
checkout. The API cases check every launch's supply against the chain
(`totalSupply`, `balanceOf(address(0))`, Core's position delta), that
ERC-20 quote launches are 404 and absent from lists when their quote is not
in the reviewed list (empty, wrong runtime or wrong chain) while the native
launches are served, that the local instance and quote pins equal the
fixture's, that the maximum-rate launches serve 2^64 - 1 exactly (schedule,
swap rates, exact-input net floor(gross / 2^64), exact-output paid
calculated * 2^64, ledgers), and that a malformed indexed supply or an indexed
fee of 2^64 fails as 500. Test-only query-method spies wire
the actual HTTP handlers to real local SQL with the reviewed local manifest;
they do not stub response rows. All temporary databases are dropped by the
harness. No RPC, fork URL, provider/secret read or production migration is used.

Safe stop is launch support OFF. A pre-issuance source rollback to the PR base
without launch routes is safe; the old staged, constructor-quote or
arbitrary-quote drafts are not. Reset only the dedicated disposable local test databases/container.
Application rollback cannot refund, withdraw, rebalance or migrate immutable
principal. No merge/deploy/live issuance or authority change is authorized.

Live provenance/registration/state, production query performance/capacity/costs,
served artifacts, mined UserOps, ERC-20 quote metadata (not indexed for the
local quote, so its name, symbol and decimals are null), downstream
whole-stack QA/Sage, external audit and legal/provider/wallet/board/release
controls remain NOT PROVEN/HOLD.
