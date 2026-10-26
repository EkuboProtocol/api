// Actual-handler replay: a local Postgres is populated by the indexer's own
// migrations, stream grouping, processors and DAO from its emitted local
// anvil chain (evm-contracts 853b608), and every launch route is read
// through the app and checked against the raw logs and the chain state the
// fixture recorded after each block. Skipped unless both are given:
//
//   ZERO_SEED_INDEXER_WORKTREE=/path/to/indexer (at INDEXER_COMMIT)
//   TEST_PG_CONNECTION_STRING=postgres://...@127.0.0.1:port/postgres
//
// Only loopback Postgres is accepted; the test creates and drops its own
// databases. No RPC, provider or remote database is used.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { app } from "../../router";
import { Queries } from "../../queries";
import { LOCAL_INSTANCES, LOCAL_QUOTES, utf8OrNull } from "./policy";
import { LaunchQueries } from "./queries";

const ROOT = process.env.ZERO_SEED_INDEXER_WORKTREE;
const SERVER = process.env.TEST_PG_CONNECTION_STRING;
// The indexer revision and fixture this replay was written against.
export const INDEXER_COMMIT = "4a2587e5b733fb4f9f5c4dd185abc66493698749";
export const FIXTURE_SHA256 =
  "b818cb5a4d939a67bd91a672f394ff32146edb9557cdf597e02ecad04d9a64d6";

const ORDERS = [
  "market_cap",
  "volume",
  "sold_share",
  "trade_count",
  "created",
] as const;
const cmpBigint = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

type Hex = `0x${string}`;
type Body = Record<string, any>;
interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}
interface Pool {
  label: string;
  poolId: Hex;
  creatorFees: [string, string];
  launchOwner: Hex;
  controller: Hex;
  feeAtBlockTime: string;
  totalSupply: string;
  sinkBalance: string;
}
interface Branch {
  blocks: { number: number; timestamp: number }[];
  logs: RawLog[];
  states: { blockNumber: number; pools: Pool[] }[];
}
interface Launch {
  poolId: Hex;
  token: Hex;
  quote: Hex;
  quoteKind: "native" | "erc20";
  tokenIsToken1: boolean;
  owner: Hex;
  requestedSupply: string;
  installedSupply: string;
  sinkSupply: string;
  liquidity: string;
  logoUrl: Hex;
  tickSpacing: number;
  alignedAskTick: number;
  alignedUpperTick: number;
}
interface Fixture {
  chainId: number;
  addresses: Record<string, Hex>;
  instances: {
    extension: Hex;
    periphery: Hex;
    extensionRuntimeKeccak: Hex;
    peripheryRuntimeKeccak: Hex;
    deploymentBlock: number;
  }[];
  launches: Record<string, Launch>;
  installations: Record<string, { owner: Hex; tradingStart: number }>;
  forkPoint: number;
  branches: { prefix: Branch; alternate: Branch; canonical: Branch };
}
interface Dao {
  begin<T>(fn: (tx: Dao) => Promise<T>): Promise<T>;
  deleteOldBlockNumbers(n: number): Promise<void>;
  insertBlock(b: {
    number: number;
    hash: bigint;
    time: Date;
    baseFeePerGas: null;
    numEvents: number;
  }): Promise<void>;
  loadDiscoveredAddresses(source: unknown): Promise<Hex[]>;
}
interface StreamBlock {
  header: { blockNumber: bigint };
  logs: { filterIds: number[] }[];
}
interface Processor {
  address: Hex;
  filter: { topics: (Hex | null)[]; strict: boolean };
}
interface Indexer {
  DAO: new (sql: unknown, chainId: bigint) => Dao;
  NumericIntegerType: unknown;
  parseEvmBlockHeader(block: unknown): {
    header: { number: number; hash: bigint; timestamp: number };
    block: unknown;
  };
  processEvmBlock(
    processors: Processor[],
    block: unknown,
    n: number,
    dao: Dao,
  ): Promise<number>;
  createLogProcessorsV3(config: Record<string, unknown>): Processor[];
  logStreamFilters(processors: Processor[]): unknown[];
  loadKnownAddresses(
    filters: unknown[],
    load: (source: unknown) => Promise<Hex[]>,
  ): Promise<unknown>;
  groupLogsByBlock(
    logs: RawLog[],
    filters: unknown[],
    known: unknown,
  ): StreamBlock[];
  shift(o: { sql: unknown; path: string }): Promise<void>;
  postgres: typeof postgres;
}

const lower = (a: string) => a.toLowerCase();
const word = (data: Hex, i: number) =>
  BigInt(`0x${data.slice(2 + 64 * i, 66 + 64 * i)}`);
const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const signed32 = (n: bigint) => Number(BigInt.asIntN(32, n));
const addr = (t: Hex) => `0x${t.slice(26)}`;

// The frozen topics (evm-contracts 853b608, vectors/zero-seed-launch.json).
const VECTORS = JSON.parse(
  readFileSync(
    resolve(import.meta.dir, "vectors/zero-seed-launch.json"),
    "utf8",
  ),
) as { abi: Record<string, { events: Record<string, Hex> }> };
const topicOf = (contract: string, prefix: string) =>
  Object.entries(VECTORS.abi[contract].events).find(([s]) =>
    s.startsWith(`${prefix}(`),
  )![1];
const T = {
  created: topicOf("ZeroSeedLaunch", "LaunchCreated"),
  swapped: topicOf("ZeroSeedLaunch", "LaunchSwapped"),
  claimed: topicOf("ZeroSeedLaunch", "CreatorFeesClaimed"),
  paid: topicOf("ZeroSeedLaunchPeriphery", "LaunchFeesClaimed"),
  owner: topicOf("ZeroSeedLaunchPeriphery", "LaunchOwnerChanged"),
};

describe.skipIf(!ROOT || !SERVER)(
  "launch routes over the indexer's replayed local chain",
  () => {
    let ix: Indexer;
    let fx: Fixture;
    let admin: ReturnType<typeof postgres>;
    const template = `zsl_api_${process.pid}_${Date.now()}`;
    const created: string[] = [];
    let CHAIN: bigint;
    let processors: Processor[];

    const urlFor = (db: string) => {
      const url = new URL(SERVER);
      url.pathname = `/${db}`;
      return url.toString();
    };

    beforeAll(async () => {
      const url = new URL(SERVER);
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        throw new Error("Only loopback test Postgres is permitted");
      const bytes = readFileSync(
        resolve(ROOT, "tests/fixtures/zero-seed-launch/local-chain.json"),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        FIXTURE_SHA256,
      );
      fx = JSON.parse(bytes.toString("utf8")) as Fixture;
      CHAIN = BigInt(fx.chainId);
      const load = async (path: string) =>
        (await import(resolve(ROOT, path))) as Record<string, unknown>;
      const dao = await load("src/_shared/dao.ts");
      const evm = await load("src/evm.ts");
      const v3 = await load("src/evm/logProcessorsV3.ts");
      const stream = await load("src/evm/logStream.ts");
      const shared = await load("src/evm/logProcessorsShared.ts");
      const shiftModule = (await import(
        Bun.resolveSync("postgres-shift", ROOT)
      )) as { default: Indexer["shift"] };
      const pg = (await import(Bun.resolveSync("postgres", ROOT))) as {
        default: typeof postgres;
      };
      ix = {
        ...(dao as unknown as Pick<Indexer, "DAO" | "NumericIntegerType">),
        ...(evm as unknown as Pick<
          Indexer,
          "parseEvmBlockHeader" | "processEvmBlock"
        >),
        ...(v3 as unknown as Pick<Indexer, "createLogProcessorsV3">),
        ...(stream as unknown as Pick<
          Indexer,
          "groupLogsByBlock" | "loadKnownAddresses"
        >),
        ...(shared as unknown as Pick<Indexer, "logStreamFilters">),
        shift: shiftModule.default,
        postgres: pg.default,
      };
      const unused = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
      const instance = fx.instances[0];
      processors = ix.createLogProcessorsV3({
        mevCaptureAddress: unused(1),
        boostedFeesConcentratedAddress: unused(2),
        boostedFeesStableswapAddress: unused(3),
        coreAddress: fx.addresses.core,
        oracleAddress: unused(4),
        incentivesAddress: unused(5),
        tokenWrapperFactoryAddress: unused(6),
        auctionsAddress: unused(7),
        twammAddresses: [],
        ordersAddresses: [],
        positionsContracts: [],
        zeroSeedLaunchPins: [
          {
            chainId: CHAIN,
            address: instance.extension,
            runtimeCodehash: instance.extensionRuntimeKeccak,
            periphery: instance.periphery,
            core: fx.addresses.core,
            deploymentBlock: instance.deploymentBlock,
            local: true,
            source: "tests/fixtures/zero-seed-launch/local-chain.json",
          },
        ],
      });
      admin = postgres(SERVER, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE ${template}`);
      const sql = ix.postgres(urlFor(template), { max: 1, onnotice: () => {} });
      await ix.shift({ sql, path: resolve(ROOT, "migrations") });
      await sql.end();
    }, 300_000);

    afterAll(async () => {
      for (const name of [...created, template])
        await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin?.end();
    }, 60_000);

    // ---- the indexer side ----------------------------------------------------

    let counter = 0;
    async function freshDb() {
      const name = `${template}_${++counter}`;
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${template}`);
      created.push(name);
      const sql = ix.postgres(urlFor(name), {
        max: 1,
        onnotice: () => {},
        types: {
          bigint: ix.postgres.BigInt,
          numeric: ix.NumericIntegerType as never,
        },
      });
      await sql`INSERT INTO indexer_cursor (chain_id, order_key, unique_key, last_updated, fork_counter)
              VALUES (${CHAIN.toString()}, 0, NULL, NOW(), 0)`;
      return { name, sql, dao: new ix.DAO(sql, CHAIN) };
    }
    type Db = Awaited<ReturnType<typeof freshDb>>;

    /** The runtime's per-block transaction, then the cursor head the API reads. */
    async function replay(
      db: Db,
      branch: Branch,
      check?: (state: Branch["states"][number], time: bigint) => Promise<void>,
    ) {
      // as the stream does: the tokens already indexed, plus those the
      // branch creates
      const filters = ix.logStreamFilters(processors);
      const known = await ix.loadKnownAddresses(filters, (source) =>
        db.dao.loadDiscoveredAddresses(source),
      );
      const blocks = ix.groupLogsByBlock(branch.logs, filters, known);
      for (const fixtureBlock of branch.blocks) {
        const block = blocks.find(
          (b) => Number(b.header.blockNumber) === fixtureBlock.number,
        );
        if (block) {
          const parsed = ix.parseEvmBlockHeader(block);
          await db.dao.begin(async (tx) => {
            await tx.deleteOldBlockNumbers(parsed.header.number);
            await tx.insertBlock({
              number: parsed.header.number,
              hash: parsed.header.hash,
              time: new Date(parsed.header.timestamp),
              baseFeePerGas: null,
              numEvents: block.logs.reduce((n, l) => n + l.filterIds.length, 0),
            });
            await ix.processEvmBlock(
              processors,
              parsed.block,
              parsed.header.number,
              tx,
            );
          });
        }
        await setHead(db);
        const state = branch.states.find(
          (s) => s.blockNumber === fixtureBlock.number,
        );
        if (check && state) await check(state, BigInt(fixtureBlock.timestamp));
      }
    }

    async function setHead(db: Db) {
      await db.sql`UPDATE indexer_cursor SET
      head_block_number = b.block_number, head_block_hash = b.block_hash,
      head_block_time = b.block_time, last_updated = NOW()
      FROM (SELECT * FROM blocks WHERE chain_id = ${CHAIN.toString()}
            ORDER BY block_number DESC LIMIT 1) b
      WHERE indexer_cursor.chain_id = ${CHAIN.toString()}`;
    }

    // ---- the API side --------------------------------------------------------

    /** Routes the app's query delegate to a local reader over the API's own connection settings. */
    function serve(db: Db, now: () => bigint, quotes = LOCAL_QUOTES) {
      const apiSql = postgres(urlFor(db.name), {
        max: 1,
        fetch_types: false,
        onnotice: () => {},
        types: { bigint: postgres.BigInt },
      });
      const reader = new LaunchQueries(apiSql as never, {
        localHarness: true,
        instances: LOCAL_INSTANCES,
        quotes,
        maxIndexAgeSeconds: 60,
        now,
      });
      const spies = [
        spyOn(Queries.prototype, "readZeroSeedList").mockImplementation((i) =>
          reader.list(i),
        ),
        spyOn(Queries.prototype, "readZeroSeedDetail").mockImplementation(
          (c, p) => reader.detail(c, p),
        ),
        spyOn(Queries.prototype, "readZeroSeedSwaps").mockImplementation((i) =>
          reader.swaps(i),
        ),
        spyOn(Queries.prototype, "readZeroSeedClaims").mockImplementation((i) =>
          reader.claims(i),
        ),
        spyOn(Queries.prototype, "readZeroSeedOwners").mockImplementation((i) =>
          reader.owners(i),
        ),
      ];
      const get = async (path: string, status = 200) => {
        const response = await app.fetch(
          new Request(`http://localhost${path}`),
          { PG_CONNECTION_STRING: urlFor(db.name) },
        );
        const body = (await response.json()) as never;
        if (response.status !== status)
          throw new Error(
            `${path}: ${response.status} ${JSON.stringify(body)}`,
          );
        return body as Body;
      };
      const stop = async () => {
        spies.forEach((s) => s.mockRestore());
        await apiSql.end();
      };
      return { get, stop };
    }

    const path = (label: string) =>
      `/launches/${CHAIN}/${fx.launches[label].poolId}`;
    const logsOf = (
      branches: Branch[],
      topic: Hex,
      poolId: Hex,
      upTo = Number.MAX_SAFE_INTEGER,
    ) =>
      branches
        .flatMap((b) => b.logs)
        .filter(
          (l) =>
            l.topics[0] === topic &&
            l.topics[1] === poolId &&
            Number(l.blockNumber) <= upTo,
        );

    /** One launch at one block: detail versus the raw LaunchCreated log and the chain state. */
    async function expectLaunch(
      get: ReturnType<typeof serve>["get"],
      pool: Pool,
      branches: Branch[],
      upTo: number,
    ) {
      const launch = fx.launches[pool.label];
      const body = await get(path(pool.label));
      const [log] = logsOf(branches, T.created, launch.poolId);
      const d = log.data;
      expect(body.schema_version).toBe("zero-seed-launch-api/v7");
      expect(body.token.address).toBe(lower(addr(log.topics[2])));
      expect(body.controller).toBe(lower(addr(log.topics[3])));
      expect(body.parameters).toEqual({
        name: hex32(word(d, 5)),
        symbol: hex32(word(d, 6)),
        supply: word(d, 7).toString(),
        quote_token: `0x${word(d, 8).toString(16).padStart(40, "0")}`,
        ask_tick: signed32(word(d, 9)).toString(),
        upper_tick: signed32(word(d, 10)).toString(),
        trading_start: word(d, 11).toString(),
        decay_rate_x32: word(d, 12).toString(),
        initial_fee: word(d, 13).toString(),
        final_fee: word(d, 14).toString(),
        salt: hex32(word(d, 15)),
      });
      // decoded from the packed words: length byte, then content
      const text = (w: bigint) => {
        const length = Number(w >> 248n);
        return utf8OrNull(
          Buffer.from(hex32(w).slice(4, 4 + 2 * length), "hex"),
        );
      };
      expect([body.token.name, body.token.symbol, body.token.decimals]).toEqual(
        [text(word(d, 5)), text(word(d, 6)), 18],
      );
      // logo: null when empty or not valid UTF-8, otherwise exactly as emitted
      const logo = Buffer.from(launch.logoUrl.slice(2), "hex");
      expect(body.logo_url).toBe(utf8OrNull(logo));
      expect(body.range).toMatchObject({
        tick_spacing: launch.tickSpacing,
        aligned_ask_tick: launch.alignedAskTick,
        aligned_upper_tick: launch.alignedUpperTick,
      });
      expect(body.pool_key.tick_spacing).toBe(launch.tickSpacing);
      expect(body.supply).toEqual({
        requested: pool.totalSupply,
        installed: launch.installedSupply,
        sink: pool.sinkBalance,
        sink_holder: "0x0000000000000000000000000000000000000000",
      });
      const is1 = body.launch_token_is_token1 as boolean;
      expect(is1).toBe(launch.tokenIsToken1);
      expect(body.fee_ledger.launch_token.unclaimed).toBe(
        pool.creatorFees[is1 ? 1 : 0],
      );
      expect(body.fee_ledger.quote_token.unclaimed).toBe(
        pool.creatorFees[is1 ? 0 : 1],
      );
      expect([body.owner, body.fee_ledger.holder, body.creator]).toEqual([
        lower(pool.launchOwner),
        lower(pool.launchOwner),
        lower(fx.installations[pool.label].owner),
      ]);
      expect(body.controller).toBe(lower(pool.controller));
      expect(body.quote_token.kind).toBe(launch.quoteKind);
      // fee rate at the head block equals the contract's feeAt there
      expect(body.fee_schedule.fee_rate).toBe(pool.feeAtBlockTime);
      expect(body.status).toBe(
        body.as_of.block_time < body.trading_start ? "upcoming" : "trading",
      );
      expect(body.market.trade_count).toBe(body.fee_ledger.swap_count);
      expect(body.market.trade_count).toBe(
        logsOf(branches, T.swapped, launch.poolId, upTo).length,
      );
      expect(BigInt(body.market.sold)).toBe(
        BigInt(launch.installedSupply) -
          BigInt(body.principal.pool_reserves.launch_token),
      );
      expect(body.market.raised).toBe(body.principal.pool_reserves.quote_token);
      return body;
    }

    /** Claims: one row per extension claim, never the payout twice. */
    async function expectClaims(
      get: ReturnType<typeof serve>["get"],
      label: string,
      branches: Branch[],
    ) {
      const launch = fx.launches[label];
      const detail = await get(path(label));
      const claims = await get(`${path(label)}/claims?limit=200`);
      const ledgerLogs = logsOf(branches, T.claimed, launch.poolId);
      const payoutLogs = logsOf(branches, T.paid, launch.poolId);
      expect(claims.data.length).toBe(ledgerLogs.length);
      expect(claims.data.length).toBe(payoutLogs.length);
      expect(claims.data.length).toBe(detail.fee_ledger.claim_count);
      const is1 = launch.tokenIsToken1;
      const sum = (logs: RawLog[], i: number) =>
        logs.reduce((n, l) => n + word(l.data, i), 0n).toString();
      const [tokenWord, quoteWord] = is1 ? [1, 0] : [0, 1];
      for (const logs of [ledgerLogs, payoutLogs]) {
        expect(sum(logs, tokenWord)).toBe(
          detail.fee_ledger.launch_token.claimed,
        );
        expect(sum(logs, quoteWord)).toBe(
          detail.fee_ledger.quote_token.claimed,
        );
      }
      expect(claims.totals).toEqual({
        launch_token: detail.fee_ledger.launch_token.claimed,
        quote_token: detail.fee_ledger.quote_token.claimed,
      });
      // owner and recipient come from the payout of the same transaction
      claims.data.forEach((c: Body, i: number) => {
        const payout = payoutLogs[i];
        expect(c.event.transaction_hash).toBe(ledgerLogs[i].transactionHash);
        expect(c.payout_event_id).not.toBe(c.event.event_id);
        expect([c.owner, c.recipient]).toEqual([
          lower(addr(payout.topics[2])),
          lower(addr(payout.topics[3])),
        ]);
      });
      return claims;
    }

    // The interface's launch-list ranking, recomputed from served fields:
    // descending; for market cap and volume, launches with a USD value
    // first by USD, then the rest by whole quote units; ties newest first.
    const micros = (usd: string) => BigInt(usd.replace(".", ""));
    function rankCompare(key: string, created: string[]) {
      const quoteUnits = (l: Body, field: string) =>
        l.quote_token.decimals === null
          ? null
          : { raw: BigInt(l.market[field]), decimals: l.quote_token.decimals };
      const cmpBig = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);
      const byUsdThenQuote = (field: string) => (a: Body, b: Body) => {
        const [ua, ub] = [a.market[`${field}_usd`], b.market[`${field}_usd`]];
        if ((ua === null) !== (ub === null)) return ua === null ? 1 : -1;
        if (ua !== null) return cmpBig(micros(ua), micros(ub));
        const [qa, qb] = [quoteUnits(a, field), quoteUnits(b, field)];
        if (qa === null || qb === null)
          return qa === qb ? 0 : qa === null ? 1 : -1;
        return cmpBig(
          qa.raw * 10n ** BigInt(qb.decimals),
          qb.raw * 10n ** BigInt(qa.decimals),
        );
      };
      const primary: Record<string, (a: Body, b: Body) => number> = {
        market_cap: byUsdThenQuote("market_cap"),
        volume: byUsdThenQuote("volume"),
        sold_share: (a, b) =>
          a.market.sold_share < b.market.sold_share
            ? 1
            : a.market.sold_share > b.market.sold_share
              ? -1
              : 0,
        trade_count: (a, b) => b.market.trade_count - a.market.trade_count,
        created: () => 0,
      };
      return (a: Body, b: Body) =>
        primary[key](a, b) ||
        created.indexOf(a.pool_id) - created.indexOf(b.pool_id);
    }

    function expectedAggregates(data: Body[]) {
      const groups = new Map<string, Body[]>();
      for (const l of data) {
        const k = `${l.chain_id}:${l.quote_token.address}`;
        groups.set(k, [...(groups.get(k) ?? []), l]);
      }
      const sum = (ls: Body[], f: (l: Body) => bigint) =>
        ls.reduce((n, l) => n + f(l), 0n);
      const usd = (v: bigint | null) =>
        v === null
          ? null
          : `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
      const usdSum = (ls: Body[], field: string) =>
        ls.some((l) => l.market[field] === null)
          ? null
          : sum(ls, (l) => micros(l.market[field]));
      const byQuote = [...groups.entries()]
        .sort(([a], [b]) => {
          const [ca, qa] = a.split(":");
          const [cb, qb] = b.split(":");
          return (
            cmpBigint(BigInt(ca), BigInt(cb)) ||
            cmpBigint(BigInt(qa), BigInt(qb))
          );
        })
        .map(([, ls]) => ({
          chain_id: ls[0].chain_id,
          quote_token: ls[0].quote_token.address,
          launch_count: ls.length,
          trade_count: ls.reduce((n, l) => n + l.market.trade_count, 0),
          volume: sum(ls, (l) => BigInt(l.market.volume)).toString(),
          market_cap: sum(ls, (l) => BigInt(l.market.market_cap)).toString(),
          usd_priced: ls[0].market.volume_usd !== null,
          volume_usd: usd(usdSum(ls, "volume_usd")),
          market_cap_usd: usd(usdSum(ls, "market_cap_usd")),
        }));
      const priced = data.filter((l) => l.market.volume_usd !== null);
      return {
        launch_count: data.length,
        trade_count: data.reduce((n, l) => n + l.market.trade_count, 0),
        by_quote: byQuote,
        usd: {
          volume: priced.length
            ? usd(sum(priced, (l) => micros(l.market.volume_usd)))
            : null,
          market_cap: priced.length
            ? usd(sum(priced, (l) => micros(l.market.market_cap_usd)))
            : null,
          priced_launch_count: priced.length,
          excluded_launch_count: data.length - priced.length,
        },
      };
    }

    async function expectOrdersAndAggregates(
      get: ReturnType<typeof serve>["get"],
      label: string,
    ) {
      const creator = fx.addresses.creator;
      for (const filter of [
        "",
        "&status=trading",
        "&status=upcoming",
        `&owner=${creator}`,
        `&creator=${creator}`,
      ]) {
        const created = (
          await get(`/launches?order_by=created&limit=200${filter}`)
        ).data.map((l: Body) => l.pool_id);
        let aggregates: unknown;
        for (const key of ORDERS) {
          const full = await get(
            `/launches?order_by=${key}&limit=200${filter}`,
          );
          const ctx = `${label} ${key}${filter}`;
          expect([ctx, full.data.length]).toEqual([ctx, full.total]);
          // the order is the interface ranking over the whole filtered set
          expect([ctx, full.data.map((l: Body) => l.pool_id)]).toEqual([
            ctx,
            [...full.data]
              .sort(rankCompare(key, created))
              .map((l: Body) => l.pool_id),
          ]);
          // pages concatenate to the full order: ordered before offset/limit
          const pages: Body[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            const page = await get(
              `/launches?order_by=${key}&limit=2&offset=${offset}${filter}`,
            );
            expect(page.aggregates).toEqual(full.aggregates);
            pages.push(...page.data);
            offset = page.next_offset;
          }
          expect(pages).toEqual(full.data);
          // aggregates cover the filtered set, never one page
          expect([ctx, full.aggregates]).toEqual([
            ctx,
            expectedAggregates(full.data),
          ]);
          aggregates ??= full.aggregates;
          expect(full.aggregates).toEqual(aggregates);
        }
      }
      // volume and trade count equal the launch's served swaps
      const all = await get(`/launches?order_by=created&limit=200`);
      for (const l of all.data) {
        const swaps = await get(
          `/launches/${l.chain_id}/${l.pool_id}/swaps?limit=200`,
        );
        expect(swaps.next_cursor).toBeNull();
        expect(swaps.data.length).toBe(l.market.trade_count);
        const volume = swaps.data.reduce((n: bigint, s: Body) => {
          const d = BigInt(s.quote_token_delta);
          return n + (d < 0n ? -d : d);
        }, 0n);
        expect(l.market.volume).toBe(volume.toString());
        expect(l.market.volume_usd === null).toBe(
          l.market.market_cap_usd === null,
        );
      }
    }

    async function everyResponse(get: ReturnType<typeof serve>["get"]) {
      const out: Record<string, unknown> = {
        list: await get(`/launches?order_by=created&limit=200`),
      };
      for (const label of ["l1", "l2", "l4", "l5", "l6", "l7", "l8"])
        for (const suffix of [
          "",
          "/swaps?limit=200",
          "/claims?limit=200",
          "/owners?limit=200",
        ])
          out[`${label}${suffix}`] = await get(`${path(label)}${suffix}`);
      return out;
    }

    test("every block: detail equals the raw logs and chain state; claims once; owners; lists; reorg and a second replay are identical", async () => {
      const db = await freshDb();
      let time = 0n;
      const { get, stop } = serve(db, () => time);
      const { prefix, alternate, canonical } = fx.branches;
      let pricedList: Body | undefined;
      try {
        const at =
          (branches: Branch[]) =>
          async (state: Branch["states"][number], blockTime: bigint) => {
            time = blockTime;
            for (const pool of state.pools)
              await expectLaunch(get, pool, branches, state.blockNumber);
          };
        await replay(db, prefix, at([prefix]));
        await replay(db, alternate, at([prefix, alternate]));
        const forked = await get(path("l3"));
        expect(forked.creator).toBe(lower(fx.addresses.newOwner));
        // reorg onto the canonical branch: l3 and the alternate transfers vanish
        await db.dao.begin((tx) => tx.deleteOldBlockNumbers(fx.forkPoint + 1));
        await replay(db, canonical, at([prefix, canonical]));
        for (const suffix of ["", "/swaps", "/claims", "/owners"])
          await get(`${path("l3")}${suffix}`, 404);
        for (const label of ["l1", "l2", "l4", "l5", "l6"])
          await expectClaims(get, label, [prefix, canonical]);

        // logos as emitted: empty and invalid UTF-8 are null, the rest raw
        const logos = Object.fromEntries(
          await Promise.all(
            ["l1", "l2", "l4", "l5"].map(async (l) => [
              l,
              (await get(path(l))).logo_url,
            ]),
          ),
        );
        expect(logos).toEqual({
          l1: "https://example.invalid/l1.svg",
          l2: null,
          l4: null,
          l5: "ipfs://bafyélogo 🚀",
        });
        expect(fx.launches.l4.logoUrl).not.toBe("0x");
        // owners: the full history from the raw logs, creator first, paged
        for (const label of ["l1", "l2"]) {
          const owners = await get(`${path(label)}/owners`);
          const logs = logsOf(
            [prefix, canonical],
            T.owner,
            fx.launches[label].poolId,
          );
          expect(
            owners.data.map((o: Record<string, unknown>) => [
              o.previous_owner,
              o.new_owner,
            ]),
          ).toEqual(
            logs.map((l) => [
              BigInt(l.topics[2]) === 0n ? null : lower(addr(l.topics[2])),
              lower(addr(l.topics[3])),
            ]),
          );
          const first = await get(`${path(label)}/owners?limit=1`);
          const rest = await get(
            `${path(label)}/owners?after_event_id=${first.next_cursor}`,
          );
          expect([...first.data, ...rest.data]).toEqual(owners.data);
          const detail = await get(path(label));
          expect(detail.owner).toBe(owners.data.at(-1).new_owner);
          expect(detail.creator).toBe(owners.data[0].new_owner);
          expect(detail.owner).not.toBe(detail.creator);
        }
        // l1 was transferred twice and then claimed by its new owner
        const l1Claims = await get(`${path("l1")}/claims`);
        expect(
          l1Claims.data.map((c: Record<string, unknown>) => c.owner),
        ).toContain(lower(fx.addresses.feeRecipient));
        // swaps and claims page without loss or overlap
        for (const suffix of ["swaps", "claims"]) {
          const all = await get(`${path("l1")}/${suffix}?limit=200`);
          const pages = [];
          let cursor: string | null = null;
          do {
            const page = await get(
              `${path("l1")}/${suffix}?limit=2${cursor ? `&after_event_id=${cursor}` : ""}`,
            );
            pages.push(...page.data);
            cursor = page.next_cursor;
          } while (cursor);
          expect(pages).toEqual(all.data);
        }

        // lists: across chains (chainId omitted) equals the chain's own list
        const created = await get(`/launches?order_by=created`);
        expect(
          created.data.map((l: Record<string, unknown>) => l.pool_id),
        ).toEqual(
          ["l8", "l7", "l6", "l5", "l4", "l2", "l1"].map(
            (l) => fx.launches[l].poolId,
          ),
        );
        expect(
          await get(`/launches?chainId=${CHAIN}&order_by=created`),
        ).toEqual(created);
        expect([created.total, created.totals, created.next_offset]).toEqual([
          7,
          { all: 7, trading: 7, upcoming: 0 },
          null,
        ]);
        expect(created.heads).toEqual([
          { chain_id: CHAIN.toString(), ...created.data[0].as_of },
        ]);
        // offset paging
        const first = await get(`/launches?order_by=created&limit=3`);
        const second = await get(
          `/launches?order_by=created&limit=3&offset=${first.next_offset}`,
        );
        const third = await get(
          `/launches?order_by=created&limit=3&offset=${second.next_offset}`,
        );
        expect([
          first.next_offset,
          second.next_offset,
          third.next_offset,
        ]).toEqual([3, 6, null]);
        expect([...first.data, ...second.data, ...third.data]).toEqual(
          created.data,
        );
        // status: before l7/l8's trading start they are upcoming
        const l7Start = BigInt(fx.installations.l7.tradingStart);
        time = l7Start - 1n;
        const upcoming = await get(`/launches?status=upcoming`);
        expect(
          upcoming.data.map((l: Record<string, unknown>) => l.pool_id).sort(),
        ).toEqual([fx.launches.l7.poolId, fx.launches.l8.poolId].sort());
        expect(
          upcoming.data.every(
            (l: Record<string, unknown>) => l.status === "upcoming",
          ),
        ).toBe(true);
        expect([upcoming.total, upcoming.totals]).toEqual([
          2,
          { all: 7, trading: 5, upcoming: 2 },
        ]);
        const trading = await get(`/launches?status=trading`);
        expect(trading.total).toBe(5);
        expect((await get(path("l7"))).fee_schedule.phase).toBe(
          "before_trading_start",
        );
        time = l7Start;
        expect((await get(`/launches?status=upcoming`)).total).toBe(0);
        expect((await get(path("l7"))).status).toBe("trading");
        // owner filter is the current owner; creator the original one
        const owned = await get(`/launches?owner=${fx.addresses.feeRecipient}`);
        expect(
          owned.data.map((l: Record<string, unknown>) => l.pool_id),
        ).toEqual([fx.launches.l1.poolId]);
        expect(
          (
            await get(
              `/launches?owner=${BigInt(fx.addresses.creator).toString()}&order_by=created`,
            )
          ).data.map((l: Record<string, unknown>) => l.pool_id),
        ).toEqual(["l7", "l5"].map((l) => fx.launches[l].poolId));
        expect(
          (
            await get(
              `/launches?creator=${fx.addresses.creator}&order_by=created`,
            )
          ).total,
        ).toBe(4);
        expect((await get(`/launches?owner=0x${"9".repeat(40)}`)).data).toEqual(
          [],
        );
        // market-cap order: by USD when the quote has a price, the rest after
        const byCap = await get(`/launches`);
        expect(
          byCap.data.every((l: Body) => l.market.market_cap_usd === null),
        ).toBe(true);
        await db.sql`INSERT INTO erc20_tokens_latest_price (chain_id, token_address, source, "timestamp", value, confidence, valid_until)
                   VALUES (${CHAIN.toString()}, 0, 'tst', NOW(), 2000, 100, NOW() + INTERVAL '1 hour')`;
        const priced = await get(`/launches`);
        const native = priced.data.filter(
          (l: Body) => l.quote_token.kind === "native",
        );
        expect(priced.data.slice(0, native.length)).toEqual(native);
        const usd = native.map((l: Body) => Number(l.market.market_cap_usd));
        expect([...usd].sort((a, b) => b - a)).toEqual(usd);
        for (const l of native) {
          const mc = BigInt(l.market.market_cap);
          expect(Number(l.market.market_cap_usd)).toBeCloseTo(
            (Number(mc) / 1e18) * 2000,
            0,
          );
        }
        await expectOrdersAndAggregates(get, "native priced");
        pricedList = await get(`/launches?order_by=volume&limit=200`);
        expect(pricedList.aggregates.usd.excluded_launch_count).toBe(
          pricedList.data.length - native.length,
        );
        await db.sql`DELETE FROM erc20_tokens_latest_price WHERE source = 'tst'`;
        await expectOrdersAndAggregates(get, "unpriced");
        // mixed quote decimals: unpriced launches rank by whole quote units
        const erc20 = BigInt(LOCAL_QUOTES[0].address).toString();
        await db.sql`INSERT INTO erc20_tokens (chain_id, token_address, token_symbol, token_name, token_decimals, visibility_priority, sort_order)
                   VALUES (${CHAIN.toString()}, ${erc20}, 'TQ', 'Test quote', 6, 0, 0)`;
        await expectOrdersAndAggregates(get, "6-decimal erc20 unpriced");
        // both quotes priced: one USD total, raw amounts still per quote
        await db.sql`INSERT INTO erc20_tokens_latest_price (chain_id, token_address, source, "timestamp", value, confidence, valid_until)
                   VALUES (${CHAIN.toString()}, 0, 'tst', NOW(), 2000, 100, NOW() + INTERVAL '1 hour'),
                          (${CHAIN.toString()}, ${erc20}, 'tst', NOW(), 0.5, 100, NOW() + INTERVAL '1 hour')`;
        await expectOrdersAndAggregates(get, "both priced");
        const mixed = (await get(`/launches?limit=200`)).aggregates;
        expect(mixed.by_quote.map((g: Body) => g.usd_priced)).toEqual([
          true,
          true,
        ]);
        expect(mixed.usd.excluded_launch_count).toBe(0);
        expect(
          micros(mixed.usd.volume) ===
            micros(mixed.by_quote[0].volume_usd) +
              micros(mixed.by_quote[1].volume_usd),
        ).toBe(true);
        await db.sql`DELETE FROM erc20_tokens_latest_price WHERE source = 'tst'`;
        await db.sql`DELETE FROM erc20_tokens WHERE chain_id = ${CHAIN.toString()} AND token_address = ${erc20}`;
        // unsupported ERC-20 quotes are screened before paging
        await stop();
        const nativeOnly = serve(db, () => time, []);
        const page = await nativeOnly.get(`/launches?order_by=created&limit=2`);
        expect(
          page.data.map((l: Record<string, unknown>) => l.pool_id),
        ).toEqual(["l5", "l1"].map((l) => fx.launches[l].poolId));
        expect(page.total).toBe(2);
        await nativeOnly.get(path("l2"), 404);
        await nativeOnly.stop();

        // a straight second replay into a fresh database serves identical bodies,
        // evaluated at the head block
        time = BigInt(canonical.blocks.at(-1)!.timestamp);
        const reread = serve(db, () => time);
        const first1 = await everyResponse(reread.get);
        if (process.env.LAUNCH_GOLDEN_DIR)
          await Bun.write(
            resolve(
              process.env.LAUNCH_GOLDEN_DIR,
              "zero-seed-launch-api-v7.golden.json",
            ),
            `${JSON.stringify(
              {
                source: {
                  indexer_commit: INDEXER_COMMIT,
                  fixture_sha256: FIXTURE_SHA256,
                  evaluated_at: Number(time),
                },
                ...first1,
                list_by_volume_native_priced: pricedList,
              },
              null,
              2,
            )}\n`,
          );
        await reread.stop();
        const db2 = await freshDb();
        await replay(db2, prefix);
        await replay(db2, canonical);
        // block heads are identical; restore the same evaluation time
        const again = serve(db2, () => time);
        expect(await everyResponse(again.get)).toEqual(first1);
        // redelivery: re-applying the last blocks changes nothing
        await replay(db2, { ...canonical, blocks: canonical.blocks.slice(-3) });
        expect(await everyResponse(again.get)).toEqual(first1);
        await again.stop();
        await db2.sql.end();

        // stale or incoherent heads are 503, naming the chain
        const late = serve(db, () => time);
        await db.sql`UPDATE indexer_cursor SET last_updated = NOW() - INTERVAL '2 minutes'`;
        await late.get(path("l1"), 503);
        await late.get(`/launches`, 503);
        await late.stop();
      } finally {
        await stop().catch(() => {});
        await db.sql.end();
      }
    }, 300_000);
  },
);
