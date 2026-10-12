// Runs the rewards queries against a real PostgreSQL. Skipped unless
// TEST_PG_CONNECTION_STRING points at a disposable database: it drops and
// recreates the incentives schema there. For example:
//
//   docker run -d --rm --name rewards-pg -e POSTGRES_PASSWORD=test \
//     -p 127.0.0.1:25628:5432 postgres:18
//   TEST_PG_CONNECTION_STRING=postgres://postgres:test@127.0.0.1:25628/postgres \
//     bun test src/routes/incentives/insights.pg.test.ts
//
// The tables are the columns of indexer migrations 00015 and 00088 that the
// queries read; computed_rewards_by_position_materialized is the view the API
// reads since 00120.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createQueries, type Queries } from "../../queries";
import { toIncentiveInsight } from "./insights";

const URL = process.env.TEST_PG_CONNECTION_STRING;

const LOCKER =
  "0x2e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067";
const OTHER_LOCKER = "0x1234";
const SALT = "2288759";
// The position the same owner withdrew before minting SALT.
const OLD_SALT = "2287941";
const CHAIN = 23448594291968334n;

const SCHEMA = `
DROP SCHEMA IF EXISTS incentives CASCADE;
CREATE SCHEMA incentives;
CREATE TABLE incentives.campaigns (
  id SERIAL8 PRIMARY KEY, chain_id int8 NOT NULL, start_time timestamptz NOT NULL,
  end_time timestamptz, slug varchar(20) NOT NULL UNIQUE, allowed_lockers NUMERIC[]);
CREATE TABLE incentives.campaign_reward_periods (
  campaign_id int REFERENCES incentives.campaigns (id), id SERIAL8 PRIMARY KEY,
  token0 numeric NOT NULL, token1 numeric NOT NULL,
  start_time timestamptz NOT NULL, end_time timestamptz NOT NULL,
  rewards_last_computed_at timestamptz);
CREATE UNIQUE INDEX ON incentives.campaign_reward_periods (campaign_id, token0, token1, start_time, end_time);
CREATE TABLE incentives.computed_rewards (
  campaign_reward_period_id int8 NOT NULL REFERENCES incentives.campaign_reward_periods (id),
  locker numeric NOT NULL, salt numeric NOT NULL, reward_amount numeric NOT NULL,
  PRIMARY KEY (campaign_reward_period_id, locker, salt));
CREATE TABLE incentives.generated_drop_reward_periods (
  drop_id int8 NOT NULL, campaign_reward_period_id int8 NOT NULL UNIQUE,
  PRIMARY KEY (drop_id, campaign_reward_period_id));
CREATE VIEW incentives.computed_rewards_by_position_materialized AS
SELECT crp.campaign_id, cr.locker, cr.salt, SUM(cr.reward_amount) AS total_reward_amount
FROM incentives.computed_rewards cr
JOIN incentives.campaign_reward_periods crp ON crp.id = cr.campaign_reward_period_id
GROUP BY 1, 2, 3;
`;

type Admin = ReturnType<typeof postgres>;

async function campaign(
  sql: Admin,
  slug: string,
  start: string,
  end: string | null,
  options: { chain?: bigint; allowedLockers?: string[] } = {},
) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO incentives.campaigns (chain_id, start_time, end_time, slug, allowed_lockers)
    VALUES (${(options.chain ?? CHAIN).toString()}, ${start}, ${end}, ${slug},
            ${options.allowedLockers ? sql`${options.allowedLockers}::NUMERIC[]` : null})
    RETURNING id`;
  return row.id;
}

async function period(
  sql: Admin,
  campaignId: string,
  start: string,
  end: string,
  { computed = true, pair = 1 }: { computed?: boolean; pair?: number } = {},
) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO incentives.campaign_reward_periods
      (campaign_id, token0, token1, start_time, end_time, rewards_last_computed_at)
    VALUES (${campaignId}, ${pair}, ${pair + 100}, ${start}, ${end},
            ${computed ? end : null})
    RETURNING id`;
  return row.id;
}

async function reward(
  sql: Admin,
  periodId: string,
  amount: string,
  { locker = LOCKER, salt = SALT } = {},
) {
  await sql`
    INSERT INTO incentives.computed_rewards (campaign_reward_period_id, locker, salt, reward_amount)
    VALUES (${periodId}, ${locker}, ${salt}, ${amount})`;
}

async function days(
  sql: Admin,
  campaignId: string,
  from: string,
  count: number,
  options: { computed?: boolean; pair?: number } = {},
) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.parse(from) + i * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    ids.push(
      await period(
        sql,
        campaignId,
        start.toISOString(),
        end.toISOString(),
        options,
      ),
    );
  }
  return ids;
}

async function seed(sql: Admin) {
  await sql.unsafe(SCHEMA);

  // Daily periods for two pairs. Oct 1-11 are computed, Oct 12 is running.
  // The position is new (minted Oct 9 after a rebalance), the old one stopped
  // earning on Oct 9, and periods up to Oct 7 are in a drop.
  const daily = await campaign(sql, "daily", "2026-10-01T00:00:00Z", null);
  const pairA = await days(sql, daily, "2026-10-01T00:00:00Z", 11);
  const pairB = await days(sql, daily, "2026-10-01T00:00:00Z", 11, {
    pair: 2,
  });
  await days(sql, daily, "2026-10-12T00:00:00Z", 1, { computed: false });
  await days(sql, daily, "2026-10-12T00:00:00Z", 1, {
    computed: false,
    pair: 2,
  });
  for (let i = 0; i < 9; i++)
    await reward(sql, pairA[i], "1000", { salt: OLD_SALT });
  await reward(sql, pairA[8], "100");
  await reward(sql, pairA[9], "200");
  await reward(sql, pairA[10], "300");
  await reward(sql, pairB[10], "50");
  await reward(sql, pairA[10], "999", { salt: "1" });
  for (let i = 0; i < 7; i++)
    await sql`INSERT INTO incentives.generated_drop_reward_periods VALUES (1, ${pairA[i]}), (1, ${pairB[i]})`;

  // Pair A has computed Oct 10, pair B has not: the frontier must not pass
  // pair B's uncomputed period.
  const delayed = await campaign(sql, "delayed", "2026-10-01T00:00:00Z", null);
  const delayedA = await days(sql, delayed, "2026-10-08T00:00:00Z", 3);
  await days(sql, delayed, "2026-10-08T00:00:00Z", 2, { pair: 2 });
  await days(sql, delayed, "2026-10-10T00:00:00Z", 1, {
    pair: 2,
    computed: false,
  });
  await reward(sql, delayedA[1], "7");
  await reward(sql, delayedA[2], "8");

  // One week-long period: it cannot be split into the last 24 hours.
  const weekly = await campaign(sql, "weekly", "2026-09-29T00:00:00Z", null);
  await reward(
    sql,
    await period(sql, weekly, "2026-09-29T00:00:00Z", "2026-10-06T00:00:00Z"),
    "700",
  );
  const weeklyNone = await campaign(
    sql,
    "weekly-none",
    "2026-09-29T00:00:00Z",
    null,
  );
  await period(sql, weeklyNone, "2026-09-29T00:00:00Z", "2026-10-06T00:00:00Z");

  // A day inside the window plus a period crossing its start that paid.
  const straddle = await campaign(
    sql,
    "straddle",
    "2026-10-01T00:00:00Z",
    null,
  );
  await reward(
    sql,
    await period(sql, straddle, "2026-10-11T00:00:00Z", "2026-10-12T00:00:00Z"),
    "30",
  );
  await reward(
    sql,
    await period(
      sql,
      straddle,
      "2026-10-10T12:00:00Z",
      "2026-10-11T12:00:00Z",
      {
        pair: 2,
      },
    ),
    "40",
  );

  // Running, computed, but the position never earned in it.
  const idle = await campaign(sql, "idle", "2026-10-01T00:00:00Z", null);
  await days(sql, idle, "2026-10-01T00:00:00Z", 11);

  // Running but nothing computed yet.
  const fresh = await campaign(sql, "fresh", "2026-10-01T00:00:00Z", null);
  await days(sql, fresh, "2026-10-01T00:00:00Z", 2, { computed: false });

  // Ended campaigns: listed only if the position earned in them.
  const endedPaid = await campaign(
    sql,
    "ended-paid",
    "2026-08-01T00:00:00Z",
    "2026-08-03T00:00:00Z",
  );
  const endedDays = await days(sql, endedPaid, "2026-08-01T00:00:00Z", 2);
  await reward(sql, endedDays[0], "11");
  await reward(sql, endedDays[1], "12");
  const endedIdle = await campaign(
    sql,
    "ended-idle",
    "2026-08-01T00:00:00Z",
    "2026-08-03T00:00:00Z",
  );
  await days(sql, endedIdle, "2026-08-01T00:00:00Z", 2);

  // Not eligible: another locker only, another chain, not started.
  const otherLocker = await campaign(
    sql,
    "other-locker",
    "2026-10-01T00:00:00Z",
    null,
    { allowedLockers: [OTHER_LOCKER] },
  );
  await days(sql, otherLocker, "2026-10-01T00:00:00Z", 11);
  const otherChain = await campaign(
    sql,
    "other-chain",
    "2026-10-01T00:00:00Z",
    null,
    { chain: 1n },
  );
  await days(sql, otherChain, "2026-10-01T00:00:00Z", 11);
  await campaign(sql, "future", "2099-01-01T00:00:00Z", null);
  // Allowed lockers that include this one.
  const ownLocker = await campaign(
    sql,
    "own-locker",
    "2026-10-01T00:00:00Z",
    null,
    { allowedLockers: [OTHER_LOCKER, LOCKER] },
  );
  await days(sql, ownLocker, "2026-10-01T00:00:00Z", 11);
}

describe.skipIf(!URL)("rewards queries on PostgreSQL", () => {
  let admin: Admin;
  let queries: Queries;

  beforeAll(async () => {
    admin = postgres(URL!, { max: 1, onnotice: () => {} });
    await seed(admin);
    queries = await createQueries({ PG_CONNECTION_STRING: URL! } as never);
  });

  afterAll(async () => {
    await admin?.end();
  });

  const insights = async (salt = SALT) =>
    Object.fromEntries(
      (await queries.listRewardInsightsForPosition(CHAIN, LOCKER, salt))
        .map(toIncentiveInsight)
        .map((insight) => [insight.campaignSlug, insight]),
    );

  test("lists the earning and the eligible running campaigns only", async () => {
    expect(Object.keys(await insights()).sort()).toEqual([
      "daily",
      "delayed",
      "ended-paid",
      "fresh",
      "idle",
      "own-locker",
      "straddle",
      "weekly",
      "weekly-none",
    ]);
  });

  test("sums both pairs over the last computed day, excluding other salts", async () => {
    expect((await insights()).daily).toEqual({
      campaignSlug: "daily",
      historyWindow: {
        startTime: "2026-10-11T00:00:00.000Z",
        endTime: "2026-10-12T00:00:00.000Z",
        amount: "350",
        status: "complete",
      },
      computedThrough: "2026-10-12T00:00:00.000Z",
    });
  });

  test("a delayed computation moves the window back instead of shrinking it", async () => {
    expect((await insights()).delayed).toMatchObject({
      historyWindow: {
        startTime: "2026-10-09T00:00:00.000Z",
        endTime: "2026-10-10T00:00:00.000Z",
        amount: "7",
        status: "complete",
      },
      computedThrough: "2026-10-10T00:00:00.000Z",
    });
  });

  test("zero is reported only when it is known", async () => {
    const all = await insights();
    expect(all.idle.historyWindow).toMatchObject({
      amount: "0",
      status: "complete",
    });
    expect(all["weekly-none"].historyWindow).toMatchObject({
      amount: "0",
      status: "complete",
    });
    expect(all.weekly.historyWindow).toEqual({
      startTime: "2026-10-05T00:00:00.000Z",
      endTime: "2026-10-06T00:00:00.000Z",
      amount: null,
      status: "unavailable",
    });
    expect(all.fresh).toEqual({
      campaignSlug: "fresh",
      historyWindow: {
        startTime: null,
        endTime: null,
        amount: null,
        status: "unavailable",
      },
      computedThrough: null,
    });
  });

  test("a paid period crossing the window edge makes the amount a subtotal", async () => {
    expect((await insights()).straddle.historyWindow).toMatchObject({
      amount: "30",
      status: "partial",
    });
  });

  test("an ended campaign reports its last day", async () => {
    expect((await insights())["ended-paid"].historyWindow).toEqual({
      startTime: "2026-08-02T00:00:00.000Z",
      endTime: "2026-08-03T00:00:00.000Z",
      amount: "12",
      status: "complete",
    });
  });

  test("rewards keep their totals; a drop only moves them out of pending", async () => {
    const rows = await queries.listComputedRewardsForPosition(
      CHAIN,
      LOCKER,
      OLD_SALT,
    );
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { slug: "daily", amount: "9000", pending: "2000" },
    ]);
    // A rebalance into a new NFT is a new salt: the old position keeps what
    // it earned and the new one starts from its own periods.
    expect((await insights(OLD_SALT)).daily.historyWindow).toMatchObject({
      amount: "0",
      status: "complete",
    });
  });
});
