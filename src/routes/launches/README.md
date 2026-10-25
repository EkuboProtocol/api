# Zero-seed launch reads (draft/local)

Response contract `zero-seed-launch-api/v6`, for the final `ZeroSeedLaunch`
and `ZeroSeedLaunchPeriphery` of the evm-contracts source freeze
`853b608ec26d4c80bdad6e394cb8ba686e1ae615` (compiled ABI file sha256
`6a131c2d…56eb` and `5d05426f…c839`). It reads the indexer's
`zero_seed_launch_*` tables of migration `00140_zero_seed_launch` (final-only).
No deployment of the final contract exists, so the hosted instance and quote
lists are empty and every launch route answers 404 when hosted.

## Changes from v5

- Final model only. The fixed-base (`fixed_base_duration_v1`) and earlier
  tick-rate drafts, the `fee_schedule.model` discriminator, their pins,
  vectors and goldens are removed. There is one fee curve: the shifted
  exponential of `decayRateX32` toward the `final_fee` floor.
- New on every launch: `logo_url`, `parameters` (every `LaunchParameters`
  field: numbers as exact decimal strings, words as 32-byte hex), `range`
  (derived `tick_spacing`, `aligned_ask_tick`, `aligned_upper_tick`, pool
  ticks), `trading_start`, `status`, `market`. `token.name`/`symbol` are
  decoded from the packed words and `token.decimals` is always 18.
  Top-level `ask_tick`/`upper_tick` moved into `parameters` as strings.
- Removed: `inventory` (see `status` and `market`), `principal.tick_*`,
  `principal.reserves_basis`, `fee_ledger.transferable`.
- Claims are one row per claim keyed on the extension's `CreatorFeesClaimed`
  (`event`), with the periphery `LaunchFeesClaimed` of the same transaction
  as `payout_event_id`, `owner` and `recipient`; the page has `totals`
  (claimed per asset, from the ledger). `ledger_event_id` is gone.
- The list spans chains (`chainId` optional), filters `status`, `owner`
  (current) and `creator` (original), orders by `market_cap` (default) or
  `created`, pages by `offset`, and reports `total`, `totals`,
  `next_offset`, `evaluated_at` and one head per chain (`heads`).

## Shapes

`LaunchSummary` (list item; `LaunchDetail` adds `principal` and `fee_ledger`):

```text
schema_version   "zero-seed-launch-api/v6"
chain_id         decimal string
pool_id          0x + 64 hex
pool_key         { core_address, token0, token1, config: bytes32, fee: "0", tick_spacing: int, extension }
token            { address, name: string|null, symbol: string|null, decimals: 18 }
quote_token      { address, name|null, symbol|null, decimals: int|null, kind: "native"|"erc20" }
launch_token_is_token1  bool
controller       address (the periphery)
creator          address (owner at creation)
owner            address (current owner; holds unclaimed and future fees)
logo_url         string|null (null when "" or not valid UTF-8; otherwise exactly as emitted)
parameters       { name: bytes32, symbol: bytes32, supply, quote_token: address, ask_tick, upper_tick,
                   trading_start, decay_rate_x32, initial_fee, final_fee: decimal strings, salt: bytes32 }
range            { tick_spacing, aligned_ask_tick, aligned_upper_tick, pool_tick_lower, pool_tick_upper: int }
supply           { requested, installed, sink: decimal strings, sink_holder: 0x0…0 }
trading_start    int (unix seconds)
status           "upcoming" (evaluated_at < trading_start) | "trading"
fee_schedule     { trading_start: int, initial_fee, final_fee, decay_rate_x32: decimal strings,
                   half_life_seconds: "s.uuuuuu"|null, saturation_elapsed_seconds: string|null,
                   phase: before_trading_start|decaying|at_floor|constant, fee_rate: decimal string,
                   evaluated_at: int }
market           { price_tick: int, price_x128, market_cap: decimal strings, market_cap_usd: string|null,
                   raised, sold: decimal strings, sold_share: "d.dddddddddddddddddd", trade_count: int }
created          { block_number, block_hash, block_time, event_id, transaction_index, event_index, transaction_hash }
as_of            { block_number, block_hash, block_time } (the launch chain's indexed head)
principal        { position_id, liquidity, locked: true, withdrawable: false,
                   pool_reserves: { launch_token, quote_token } }
fee_ledger       { holder, launch_token: { accrued, claimed, unclaimed }, quote_token: {…},
                   swap_count, claim_count, owner_change_count: int, last_event_id }
```

`LaunchList`: `{ schema_version, data: LaunchSummary[], total, totals: { all,
trading, upcoming }, next_offset: int|null, evaluated_at: int, heads: [{
chain_id, block_number, block_hash, block_time }] }`. `total` counts every
filter; `totals` counts the non-status filters by status.

Market: `price_x128` is raw quote per raw launch token times 2^128, floored,
from Core's sqrt ratio; `market_cap = floor(price * totalSupply)` in raw quote
units (the sink is not a burn and is included); `market_cap_usd` uses the
indexed quote price (6 decimals) and is null without one; `raised` is the
quote the pool holds; `sold = installed - launch tokens in the pool`;
`trade_count` counts `LaunchSwapped`, including zero fills.

Status and `fee_rate` are evaluated at the request's wall-clock second
(`evaluated_at`); `as_of`/`heads` are the indexed heads. Fee math:
`fee = final + floor((initial - final) * toFixed(tickToSqrtRatio(-m)) / 2^128)`,
`m = floor(rate * elapsed / 2^32)`, initial before and at the start and for
rate 0, `final` once `elapsed > 381061679028371455 / rate`; checked against the
freeze's fee rows, curve tables, tick steps, saturation seconds and SHA-256
chains (`policy.test.ts`).

## Requests

- `GET /launches?chainId=&status=all|trading|upcoming&owner=&creator=&order_by=market_cap|created&offset=0&limit=50`
- `GET /launches/{chainId}/{poolId}`
- `GET /launches/{chainId}/{poolId}/swaps?limit=50&after_event_id=…`
- `GET /launches/{chainId}/{poolId}/claims?limit=50&after_event_id=…`
- `GET /launches/{chainId}/{poolId}/owners?limit=50&after_event_id=…`

Limits are 1–200, offsets 0–100000. Histories are oldest first with signed
decimal event-id cursors. Validation errors are 400 and name the parameter
(`Invalid query: status: …`). Missing/unsupported launches are 404; a missing,
mismatched or stale head of a chain in scope is 503 naming the chain;
malformed indexed rows (non-canonical packed name, inconsistent range or
supply, fee outside uint64, claim without its payout) fail as 500.

## Supported instances and consistency

Hosted readers enable no instance and no ERC-20 quote. Only the explicit local
harness may pass the reviewed local manifest (`LOCAL_INSTANCES`, the
indexer fixture's instance, and `LOCAL_QUOTES`, its relocated test ERC-20).
SQL screens chain, extension, periphery controller, Core, ordered pair, zero
fee, spacing and the launch's own quote before ordering and paging. Each read
is one read-only repeatable-read transaction. Responses are `no-store`.
Logos and names are untrusted creator input: they are never fetched,
rewritten or sanitized here; clients must escape them and must not fetch
logo URLs unsafely.

## Local verification

`bun run format:check`, `bun run lint`, `bun run typecheck`, `bun test`.
`bun run openapi` regenerates `openapi.json`.

`replay.postgres.test.ts` populates a disposable loopback Postgres through the
indexer's own migrations, stream grouping, processors and DAO from its local
anvil chain (`tests/fixtures/zero-seed-launch/local-chain.json`, sha256
pinned in the test) and reads every route through the app:

```sh
docker run -d --rm --name launch-api-pg -p 127.0.0.1:55491:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:18
ZERO_SEED_INDEXER_WORKTREE=/path/to/indexer \
TEST_PG_CONNECTION_STRING=postgres://postgres:postgres@127.0.0.1:55491/postgres \
bun test src/routes/launches/replay.postgres.test.ts
```

It checks after every block each launch's parameters and packed metadata
against the raw `LaunchCreated` log, logo, range, supply, ledger, owner,
creator, controller and `feeAt` against the chain state; claims once per
extension claim (counts and sums equal both the extension and the periphery
logs); owner history and paging; list filters, totals, offsets, market-cap
order and quote screening; a reorg; and that a second straight replay and a
redelivery serve identical bodies. With `LAUNCH_GOLDEN_DIR` set it writes
`zero-seed-launch-api-v6.golden.json`; copy it to `fixtures/` and run
`bun run format`.

Safe stop is launch support off. No deployment, live database, merge or
release is authorized by this draft.
