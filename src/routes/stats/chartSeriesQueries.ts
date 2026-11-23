import type { Sql } from "postgres";

export type ChartSeriesFilters = {
  chainId: bigint | null;
  /** Restricts to one pair, and includes its tokens whatever their visibility. */
  pair?: { token0: bigint; token1: bigint };
  coreAddress?: bigint;
  poolId?: bigint;
};

export type ChartSeriesRequest = ChartSeriesFilters & {
  /** Token symbols shown on their own per network; the rest are summed. */
  maxSymbols: number;
  /** First and last UTC day of the chart, as YYYY-MM-DD. */
  firstDate: string;
  lastDate: string;
  /** Symbols are ranked by their value on the days from this one, YYYY-MM-DD. */
  rankFromDate: string;
};

/**
 * One chart value of a network: a ranked token symbol and UI multiplier, or
 * every other symbol of the network (symbol and multiplier null).
 */
export type ChartSeriesRow = {
  chain_id: bigint;
  symbol: string | null;
  /** UI multiplier of the symbol's tokens, 18 decimals; null for the rest. */
  ui_multiplier: string | null;
  rank: string | number;
  date: string;
  usd: number;
  amount: number | null;
};

// A token whose value stays under this, priced at its current price, is priced
// at its current price on every day instead of having its history looked up.
// It cannot move a chart, and skipping it keeps the per-day lookups to the
// tokens that can.
const HISTORIC_PRICE_MIN_USD = 10;

type Db = Sql<{ bigint: bigint }>;

function poolKeyConditions(sql: Db, filters: ChartSeriesFilters) {
  const { chainId, pair, coreAddress, poolId } = filters;
  return sql`
    ${chainId !== null ? sql`pk.chain_id = ${chainId}` : sql`TRUE`}
    AND ${pair ? sql`pk.token0 = ${pair.token0.toString()} AND pk.token1 = ${pair.token1.toString()}` : sql`TRUE`}
    AND ${coreAddress !== undefined ? sql`pk.core_address = ${coreAddress.toString()}` : sql`TRUE`}
    AND ${poolId !== undefined ? sql`pk.pool_id = ${poolId.toString()}` : sql`TRUE`}
  `;
}

function chartDays(sql: Db, { firstDate, lastDate }: ChartSeriesRequest) {
  return sql`
    SELECT d AT TIME ZONE 'UTC'     AS day_start,
           to_char(d, 'YYYY-MM-DD') AS date,
           d = ${lastDate}::timestamp AS is_today
    FROM generate_series(${firstDate}::timestamp, ${lastDate}::timestamp, INTERVAL '1 day') AS d
  `;
}

// The USD price of a token at the close of a UTC day: the latest observation
// in that day, or the day before when the token had none. Observations from
// the last day are still in erc20_tokens_usd_prices; older ones were folded
// into erc20_tokens_usd_prices_hourly (31 days, the latest observation of each
// hour), so the day's close is the later of the two. Each lookup is one
// backward index scan per table. The raw table is only read for the last
// three days, which a one-time filter decides before touching it.
// Reads the token-day from the token_days row aliased td.
function dayClosePrice(sql: Db, recentFrom: Date) {
  return sql`(
    SELECT obs.value
    FROM (
      (SELECT p."timestamp", p.value
       FROM erc20_tokens_usd_prices p
       WHERE td.day_start >= ${recentFrom}
         AND p.chain_id = td.chain_id
         AND p.token_address = td.token
         AND p."timestamp" >= td.day_start - INTERVAL '1 day'
         AND p."timestamp" < td.day_start + INTERVAL '1 day'
       ORDER BY p."timestamp" DESC
       LIMIT 1)
      UNION ALL
      (SELECT h."timestamp", h.value
       FROM erc20_tokens_usd_prices_hourly h
       WHERE h.chain_id = td.chain_id
         AND h.token_address = td.token
         AND h.hour >= td.day_start - INTERVAL '1 day'
         AND h.hour < td.day_start + INTERVAL '1 day'
       ORDER BY h.hour DESC
       LIMIT 1)
    ) AS obs
    ORDER BY obs."timestamp" DESC
    LIMIT 1
  )`;
}

// The UI multiplier in effect now, 18 decimals, of the token aliased t; 1e18
// for a token without one. Applied to the whole history like decimals: it is a
// display unit, not a value at a date.
const uiMultiplier = (sql: Db) => sql`
  COALESCE((SELECT m.ui_multiplier
            FROM erc20_tokens_effective_ui_multipliers m
            WHERE m.chain_id = t.chain_id
              AND m.token_address = t.token_address), 1e18)`;

// Prices each token-day (today and small tokens at the current price), sums
// the values per network, symbol, UI multiplier and day, ranks each network's
// symbols by their value from rankFromDate and folds every symbol past
// maxSymbols into one null symbol per network. Tokens sharing a symbol are only
// summed when they share a multiplier, so the summed amount has one display
// unit.
function priceGroupAndRank(
  sql: Db,
  request: ChartSeriesRequest,
  recentFrom: Date,
) {
  return sql`
    priced AS (
      SELECT td.*,
             CASE
               WHEN td.is_today OR td.max_usd_at_latest < ${HISTORIC_PRICE_MIN_USD}
                 THEN td.latest_price
               ELSE COALESCE(${dayClosePrice(sql, recentFrom)}, td.latest_price)
             END AS usd_price
      FROM token_days td
    ),
    grouped AS (
      SELECT chain_id,
             token_symbol::text      AS symbol,
             ui_multiplier,
             date,
             SUM(amount * usd_price) AS usd,
             SUM(amount)             AS amount
      FROM priced
      GROUP BY 1, 2, 3, 4
    ),
    ranked AS (
      SELECT chain_id,
             symbol,
             ui_multiplier,
             ROW_NUMBER() OVER (
               PARTITION BY chain_id
               ORDER BY COALESCE(SUM(usd) FILTER (WHERE date >= ${request.rankFromDate}), 0) DESC,
                        symbol,
                        ui_multiplier
             ) AS rank
      FROM grouped
      GROUP BY chain_id, symbol, ui_multiplier
    )
    SELECT g.chain_id,
           CASE WHEN r.rank <= ${request.maxSymbols} THEN g.symbol END AS symbol,
           CASE WHEN r.rank <= ${request.maxSymbols} THEN g.ui_multiplier::text END AS ui_multiplier,
           MIN(r.rank)                                                AS rank,
           g.date,
           SUM(g.usd)::float8                                         AS usd,
           CASE WHEN MIN(r.rank) <= ${request.maxSymbols} THEN SUM(g.amount)::float8 END AS amount
    FROM grouped g
             JOIN ranked r USING (chain_id, symbol, ui_multiplier)
    GROUP BY 1, 2, 3, 5
    ORDER BY 1, 4, 5
  `;
}

const recentFromNow = () => new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

/**
 * TVL at the close of each day, priced at that day's close. A token's balance
 * at the close of a day is its current balance minus the deltas of the days
 * after it.
 */
export function queryTvlChartRows(sql: Db, request: ChartSeriesRequest) {
  return sql<ChartSeriesRow[]>`
    WITH days AS (${chartDays(sql, request)}),
    pools AS (
      SELECT pk.pool_key_id, pk.chain_id, pk.token0, pk.token1
      FROM pool_keys pk
      WHERE ${poolKeyConditions(sql, request)}
    ),
    balances AS (
      SELECT pools.chain_id, tb.token, SUM(tb.balance) AS balance
      FROM pool_tvl ptvl
               JOIN pools USING (pool_key_id)
               CROSS JOIN LATERAL (VALUES (pools.token0, ptvl.balance0),
                                          (pools.token1, ptvl.balance1)) AS tb (token, balance)
      GROUP BY 1, 2
    ),
    deltas AS (
      SELECT pools.chain_id,
             htd.token,
             DATE_TRUNC('day', htd.hour, 'UTC') AS day_start,
             SUM(htd.delta)                     AS delta
      FROM hourly_tvl_delta_by_token htd
               JOIN pools USING (pool_key_id)
      WHERE htd.hour >= ${request.firstDate}::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1, 2, 3
    ),
    tokens AS (
      SELECT b.chain_id,
             b.token,
             b.balance,
             t.token_symbol,
             ${uiMultiplier(sql)}          AS ui_multiplier,
             10::float8 ^ t.token_decimals AS scale,
             lp.value                      AS latest_price
      FROM balances b
               JOIN erc20_tokens t ON t.chain_id = b.chain_id AND t.token_address = b.token
               JOIN erc20_tokens_latest_price lp ON lp.chain_id = b.chain_id AND lp.token_address = b.token
      WHERE lp.value > 0
    ),
    balances_by_day AS (
      SELECT tk.chain_id,
             tk.token,
             tk.token_symbol,
             tk.ui_multiplier,
             tk.latest_price,
             d.day_start,
             d.date,
             d.is_today,
             (tk.balance - COALESCE(SUM(dl.delta) OVER (
               PARTITION BY tk.chain_id, tk.token
               ORDER BY d.day_start DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0))::float8 / tk.scale AS amount
      FROM tokens tk
               CROSS JOIN days d
               LEFT JOIN deltas dl
                         ON dl.chain_id = tk.chain_id AND dl.token = tk.token AND dl.day_start = d.day_start
    ),
    token_days AS (
      SELECT *,
             MAX(ABS(amount)) OVER (PARTITION BY chain_id, token) * latest_price AS max_usd_at_latest
      FROM balances_by_day
    ),
    ${priceGroupAndRank(sql, request, recentFromNow())}
  `;
}

/** Volume of each day, priced at that day's close. */
export function queryVolumeChartRows(sql: Db, request: ChartSeriesRequest) {
  return sql<ChartSeriesRow[]>`
    WITH days AS (${chartDays(sql, request)}),
    volume AS (
      SELECT pk.chain_id,
             hvbt.token,
             DATE_TRUNC('day', hvbt.hour, 'UTC') AS day_start,
             SUM(hvbt.volume)                    AS volume
      FROM hourly_volume_by_token hvbt
               JOIN pool_keys pk USING (pool_key_id)
      WHERE hvbt.hour >= ${request.firstDate}::timestamp AT TIME ZONE 'UTC'
        AND ${poolKeyConditions(sql, request)}
      GROUP BY 1, 2, 3
    ),
    token_days AS (
      SELECT v.chain_id,
             v.token,
             t.token_symbol,
             ${uiMultiplier(sql)}                           AS ui_multiplier,
             lp.value                                       AS latest_price,
             d.day_start,
             d.date,
             d.is_today,
             v.volume::float8 / 10::float8 ^ t.token_decimals AS amount,
             v.volume::float8 / 10::float8 ^ t.token_decimals * lp.value AS max_usd_at_latest
      FROM volume v
               JOIN days d USING (day_start)
               JOIN erc20_tokens t ON t.chain_id = v.chain_id AND t.token_address = v.token
               JOIN erc20_tokens_latest_price lp ON lp.chain_id = v.chain_id AND lp.token_address = v.token
      WHERE lp.value > 0
        AND (t.visibility_priority >= 0 OR ${request.pair ? sql`TRUE` : sql`FALSE`})
    ),
    ${priceGroupAndRank(sql, request, recentFromNow())}
  `;
}
