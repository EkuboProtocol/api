import { Client } from "pg";
import Decimal from "decimal.js-light";
import { Env } from "./env";

interface PositionMetadata {
  lower_bound: string;
  upper_bound: string;
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: string;
  extension: string;
  minted_timestamp: Date;
  minted_tx_hash: string;
}

interface TwammOrderMetadata {
  sell_token: string;
  buy_token: string;
  start_time: Date;
  end_time: Date;
  fee: string;
  block_time_at_start: Date;
  last_order_update: Date;
  last_collect_proceeds: Date | null;
  points: string;
}

export interface BasePoolStateQueryResult {
  pool_key_hash: string;
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: string;
  extension: string;
  sqrt_ratio: string;
  tick: number;
  liquidity: string;
  last_event_id: string;
  last_liquidity_update_event_id: string | null;
}

export interface TwammPoolStateQueryResult extends BasePoolStateQueryResult {
  token0_sale_rate: string;
  token1_sale_rate: string;
  last_execution_time: Date;
}

export class Queries {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async getBlock(blockTag: "latest" | number) {
    const { rows } = await this.client.query<{
      number: string;
      hash: string;
      timestamp: string;
    }>({
      text: `
                SELECT number, hash, time AS timestamp
                FROM blocks
                WHERE number = $1
                   OR $1 IS NULL
                ORDER BY number DESC
                LIMIT 1
            `,
      values: [blockTag === "latest" ? null : blockTag],
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getAllPoolsWithStates() {
    return this.client.query<
      Omit<BasePoolStateQueryResult, "last_liquidity_update_event_id">
    >(`
            SELECT pool_key_hash,
                   token0,
                   token1,
                   fee,
                   tick_spacing,
                   extension,
                   sqrt_ratio,
                   tick,
                   liquidity,
                   last_event_id
            FROM pool_states_materialized
                     JOIN pool_keys ON pool_key_hash = key_hash
        `);
  }

  public async getAllRoutablePools({
    tokenA,
    tokenB,
  }: {
    tokenA: bigint;
    tokenB: bigint;
  }) {
    return this.client.query<{
      token0: string;
      token1: string;
      fee: string;
      tick_spacing: number;
      extension: string;
      sqrt_ratio: string;
      liquidity: string;
      tick: number;
      ticks: { t: number; l: string }[];
      last_virtual_execution_time: string | null;
      token0_sale_rate: string | null;
      token1_sale_rate: string | null;
      orders: { t: string; s0: string; s1: string }[];
    }>({
      text: `
        WITH paired_with_a AS (SELECT (CASE WHEN token0 = $1 THEN token1 ELSE token0 END) AS token
                               FROM pool_keys
                               WHERE token0 = $1
                                  OR token1 = $1),
             paired_with_b AS (SELECT (CASE WHEN token0 = $2 THEN token1 ELSE token0 END) AS token
                               FROM pool_keys
                               WHERE token0 = $2
                                  OR token1 = $2),
             paired_with_both AS (SELECT token
                                  FROM paired_with_a
                                  INTERSECT
                                  SELECT token
                                  FROM paired_with_b),
             relevant_pools AS (SELECT key_hash
                                FROM pool_keys pk
                                WHERE ((pk.token0 IN ($1, $2) OR
                                        pk.token0 IN (SELECT token FROM paired_with_both)) AND
                                       (pk.token1 IN ($1, $2) OR
                                        pk.token1 IN (SELECT token FROM paired_with_both))))
        SELECT pk.token0,
               pk.token1,
               pk.fee,
               pk.tick_spacing,
               pk.extension,
               psm.sqrt_ratio,
               psm.liquidity,
               psm.tick,
               (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('t', ppptlm.tick, 'l',
                                                    ppptlm.net_liquidity_delta_diff::TEXT) ORDER BY ppptlm.tick)
                FROM per_pool_per_tick_liquidity_materialized ppptlm
                WHERE ppptlm.pool_key_hash = pk.key_hash) AS ticks,
               -- twamm state
               tpsm.last_virtual_execution_time,
               tpsm.token0_sale_rate,
               tpsm.token1_sale_rate,
               (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('t', tsrdm.time, 's0', tsrdm.net_sale_rate_delta0::TEXT,
                                                    's1',
                                                    tsrdm.net_sale_rate_delta1::TEXT) ORDER BY tsrdm.time)
                FROM twamm_sale_rate_deltas_materialized tsrdm
                WHERE tsrdm.pool_key_hash = pk.key_hash)  AS orders
        FROM relevant_pools rp
               JOIN pool_keys pk ON rp.key_hash = pk.key_hash
               JOIN pool_states_materialized psm ON rp.key_hash = psm.pool_key_hash
               LEFT JOIN twamm_pool_states_materialized tpsm ON rp.key_hash = tpsm.pool_key_hash
        WHERE
          -- only twamm pools or 0 extension pools
          (extension = 0 OR tpsm.pool_key_hash IS NOT NULL)
      `,
      values: [tokenA, tokenB],
    });
  }

  public async getTwammPoolStateByKey({
    token0,
    token1,
    fee,
  }: {
    token0: bigint;
    token1: bigint;
    fee?: bigint;
  }) {
    return this.client.query<
      Pick<
        TwammPoolStateQueryResult,
        "token0_sale_rate" | "token1_sale_rate" | "last_execution_time"
      >
    >({
      text: `
                SELECT token0_sale_rate,
                       token1_sale_rate,
                       tpsm.last_virtual_execution_time AS last_execution_time
                FROM twamm_pool_states_materialized AS tpsm
                         JOIN pool_states_materialized psm ON psm.pool_key_hash = tpsm.pool_key_hash
                         JOIN pool_keys pk ON tpsm.pool_key_hash = pk.key_hash
                WHERE pk.token0 = $1
                  AND pk.token1 = $2
                  AND pk.fee = COALESCE($3, pk.fee)
            `,
      values: [token0, token1, fee ?? null],
    });
  }

  public async getSaleRateDeltasByKey({
    token0,
    token1,
    fee,
  }: {
    token0: bigint;
    token1: bigint;
    fee?: bigint;
  }) {
    return this.client.query<{
      time: Date;
      net_sale_rate_delta0: string;
      net_sale_rate_delta1: string;
    }>({
      text: `
                SELECT time, net_sale_rate_delta0, net_sale_rate_delta1
                FROM twamm_sale_rate_deltas_materialized AS tsrdm
                         JOIN pool_keys pk ON tsrdm.pool_key_hash = pk.key_hash
                WHERE pk.token0 = $1
                  AND pk.token1 = $2
                  AND pk.fee = COALESCE($3, pk.fee)
                ORDER BY time
            `,
      values: [token0, token1, fee ?? null],
    });
  }

  // Returns all pools containing either tokenA or tokenB and their states
  public async getRegisteredTokens() {
    return this.client.query<{
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      total_supply: string;
    }>(`
            WITH last_key_per_address AS (SELECT address,
                                                 (SELECT event_id
                                                  FROM token_registrations AS trr
                                                  WHERE trr.address = tr.address
                                                  ORDER BY event_id DESC
                                                  LIMIT 1) AS last_registration_id
                                          FROM token_registrations tr
                                          GROUP BY address)
            SELECT lk.address,
                   tr.name,
                   tr.symbol,
                   tr.decimals,
                   tr.total_supply
            FROM last_key_per_address AS lk
                     JOIN token_registrations AS tr
                          ON lk.address = tr.address
                              AND lk.last_registration_id = tr.event_id
            ORDER BY address
        `);
  }

  public async getPositionMetadata(
    id: number,
  ): Promise<PositionMetadata | null> {
    const { rows, rowCount } = await this.client.query<PositionMetadata>({
      text: `
                SELECT event_keys.transaction_hash AS minted_tx_hash,
                       mint_position_update.lower_bound,
                       mint_position_update.upper_bound,
                       pool_keys.token0,
                       pool_keys.token1,
                       pool_keys.fee,
                       pool_keys.tick_spacing,
                       pool_keys.extension,
                       blocks.time                 AS minted_timestamp
                FROM position_transfers AS pt
                         LEFT JOIN LATERAL (
                    SELECT lower_bound, upper_bound, pool_key_hash
                    FROM position_updates AS pu
                    WHERE pu.salt = token_id::NUMERIC
                    LIMIT 1
                    ) AS mint_position_update ON TRUE
                         JOIN pool_keys ON mint_position_update.pool_key_hash = pool_keys.key_hash
                         JOIN event_keys ON pt.event_id = event_keys.id
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE token_id = $1
                  AND from_address = 0
                LIMIT 1
            `,
      values: [id],
    });

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getOrderMetadata(id: number) {
    const { rows, rowCount } = await this.client.query<{
      minted_tx_hash: string;
      minted_timestamp: Date;
      start_time: Date;
      end_time: Date;
      last_update_time: Date;
      token0: string;
      sale_rate0: string;
      token1: string;
      sale_rate1: string;
      fee: string;
    }>({
      text: `
                SELECT event_keys.transaction_hash AS minted_tx_hash,
                       blocks.time                 AS minted_timestamp,
                       start_time,
                       end_time,
                       last_update_time,
                       token0,
                       sale_rate0,
                       token1,
                       sale_rate1,
                       fee
                FROM position_transfers AS transfer
                         LEFT JOIN LATERAL (
                    SELECT ou.key_hash           AS pool_key_hash,
                           ou.start_time         AS start_time,
                           ou.end_time           AS end_time,
                           MAX(b.time)           AS last_update_time,
                           SUM(sale_rate_delta0) AS sale_rate0,
                           SUM(sale_rate_delta1) AS sale_rate1
                    FROM twamm_order_updates AS ou
                             JOIN event_keys ek ON event_id = id
                             JOIN blocks b ON block_number = number
                    WHERE ou.salt = token_id::NUMERIC
                    GROUP BY ou.key_hash, ou.start_time, ou.end_time
                    ) AS order_data ON TRUE
                         JOIN pool_keys ON order_data.pool_key_hash = key_hash
                         JOIN event_keys ON transfer.event_id = event_keys.id
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE token_id = $1
                  AND from_address = 0
            `,
      values: [id],
    });
    return rows;
  }

  public async getPositionState(id: number) {
    const { rows, rowCount } = await this.client.query<{
      points_earned: string;
      last_owner: string;
    }>({
      text: `
                SELECT (SELECT SUM(points)
                        FROM leaderboard AS l
                        WHERE l.collector = pt.to_address
                          AND l.token_id = pt.token_id) AS points_earned,
                       to_address                       AS last_owner
                FROM position_transfers pt
                WHERE token_id = $1
                  AND to_address != 0
                ORDER BY event_id DESC
                LIMIT 1;
            `,
      values: [id],
    });

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getPositionHistory(id: number) {
    const { rows } = await this.client.query<
      | {
          type: 0;
          transaction_hash: string;
          timestamp: string;
          from_address: string;
          to_address: string;
          liquidity_delta: null;
          delta0: null;
          delta1: null;
        }
      | {
          type: 1;
          transaction_hash: string;
          timestamp: string;
          from_address: null;
          to_address: null;
          liquidity_delta: string;
          delta0: string;
          delta1: string;
        }
      | {
          type: 2;
          transaction_hash: string;
          timestamp: string;
          from_address: null;
          to_address: null;
          liquidity_delta: null;
          delta0: string;
          delta1: string;
        }
      | {
          type: 3;
          transaction_hash: string;
          timestamp: string;
          from_address: null;
          to_address: null;
          liquidity_delta: null;
          delta0: string;
          delta1: string;
        }
    >({
      text: `
                WITH transfers AS (SELECT transaction_hash,
                                          time AS timestamp,
                                          from_address,
                                          to_address
                                   FROM position_transfers
                                            JOIN event_keys ek ON event_id = id
                                            JOIN blocks b ON block_number = number
                                   WHERE token_id = $1
                                     AND from_address != 0
                                     AND to_address != 0),
                     updates AS (SELECT transaction_hash,
                                        time AS timestamp,
                                        liquidity_delta,
                                        delta0,
                                        delta1
                                 FROM position_transfers AS pt
                                          JOIN position_updates AS pu ON pu.salt = pt.token_id
                                          JOIN event_keys AS puek ON pu.event_id = puek.id
                                          JOIN blocks AS b ON puek.block_number = b.number
                                 WHERE pt.token_id = $1
                                   AND from_address = 0),
                     fee_collections AS (SELECT transaction_hash,
                                                time AS timestamp,
                                                delta0,
                                                delta1
                                         FROM position_transfers AS pt
                                                  JOIN position_fees_collected AS pfc ON pfc.salt = pt.token_id
                                                  JOIN event_keys AS puek ON pfc.event_id = puek.id
                                                  JOIN blocks AS b ON puek.block_number = b.number
                                         WHERE pt.token_id = $1
                                           AND from_address = 0),
                     protocol_fees AS (SELECT transaction_hash,
                                              time AS timestamp,
                                              delta0,
                                              delta1
                                       FROM position_transfers AS pt
                                                JOIN protocol_fees_paid AS pfp ON pfp.salt = pt.token_id
                                                JOIN event_keys AS puek ON pfp.event_id = puek.id
                                                JOIN blocks AS b ON puek.block_number = b.number
                                       WHERE pt.token_id = $1
                                         AND from_address = 0),
                     all_events AS (SELECT 0    AS type,
                                           transaction_hash,
                                           timestamp,
                                           from_address,
                                           to_address,
                                           NULL AS liquidity_delta,
                                           NULL AS delta0,
                                           NULL AS delta1
                                    FROM transfers
                                    UNION ALL
                                    SELECT 1    AS type,
                                           transaction_hash,
                                           timestamp,
                                           NULL AS from_address,
                                           NULL AS to_address,
                                           liquidity_delta,
                                           delta0,
                                           delta1
                                    FROM updates
                                    UNION ALL
                                    SELECT 2    AS type,
                                           transaction_hash,
                                           timestamp,
                                           NULL AS from_address,
                                           NULL AS to_address,
                                           NULL AS liquidity_delta,
                                           delta0,
                                           delta1
                                    FROM fee_collections
                                    UNION ALL
                                    SELECT 3    AS type,
                                           transaction_hash,
                                           timestamp,
                                           NULL AS from_address,
                                           NULL AS to_address,
                                           NULL AS liquidity_delta,
                                           delta0,
                                           delta1
                                    FROM protocol_fees)
                SELECT *
                FROM all_events
                ORDER BY timestamp DESC
            `,
      values: [id],
    });
    return rows;
  }

  public async getPairLiquidityGraph({
    token0,
    token1,
  }: {
    token0: bigint;
    token1: bigint;
  }) {
    const { rows } = await this.client.query<{
      tick: string;
      net_liquidity_delta_diff: string;
    }>({
      text: `
                SELECT tick, SUM(net_liquidity_delta_diff) AS net_liquidity_delta_diff
                FROM per_pool_per_tick_liquidity_materialized
                         JOIN pool_keys ON pool_key_hash = key_hash
                WHERE net_liquidity_delta_diff != 0
                  AND token0 = $1
                  AND token1 = $2
                GROUP BY tick
                ORDER BY tick
            `,
      values: [token0, token1],
    });
    return rows;
  }

  public getPoolLiquidityGraph(poolKeyHash: bigint) {
    return this.client.query<{
      tick: string;
      net_liquidity_delta_diff: string;
    }>({
      text: `
                SELECT tick, net_liquidity_delta_diff
                FROM per_pool_per_tick_liquidity_materialized
                WHERE pool_key_hash = $1
                ORDER BY tick
            `,
      values: [poolKeyHash],
    });
  }

  public getPairEvents({
    token0,
    token1,
    limit,
  }: {
    token0: bigint;
    token1: bigint;
    limit: number;
  }) {
    return this.client.query<{
      type: 0 | 1;

      key_hash: string;
      fee: string;
      tick_spacing: string;
      extension: string;

      timestamp: string;

      transaction_hash: string;
      block_number: bigint;
      index: bigint;

      delta0: string;
      delta1: string;
    }>({
      text: `
                WITH relevant_pool_keys AS (SELECT key_hash, fee, extension, tick_spacing
                                            FROM pool_keys
                                            WHERE token0 = $1
                                              AND token1 = $2),
                     relevant_swaps AS (SELECT 0                           AS type,
                                               relevant_pool_keys.key_hash AS pool_key_hash,
                                               relevant_pool_keys.fee,
                                               relevant_pool_keys.tick_spacing,
                                               relevant_pool_keys.extension,
                                               blocks.time                 AS timestamp,
                                               transaction_hash,
                                               block_number,
                                               transaction_index,
                                               event_index,
                                               locker,
                                               delta0,
                                               delta1
                                        FROM swaps
                                                 JOIN relevant_pool_keys ON key_hash = pool_key_hash
                                                 JOIN event_keys ON swaps.event_id = event_keys.id
                                                 JOIN blocks ON event_keys.block_number = blocks.number),
                     relevant_updates AS (SELECT 1                           AS type,
                                                 relevant_pool_keys.key_hash AS pool_key_hash,
                                                 relevant_pool_keys.fee,
                                                 relevant_pool_keys.tick_spacing,
                                                 relevant_pool_keys.extension,
                                                 blocks.time                 AS timestamp,
                                                 transaction_hash,
                                                 block_number,
                                                 transaction_index,
                                                 event_index,
                                                 locker,
                                                 delta0,
                                                 delta1
                                          FROM position_updates
                                                   JOIN relevant_pool_keys
                                                        ON key_hash = pool_key_hash
                                                   JOIN event_keys ON position_updates.event_id = event_keys.id
                                                   JOIN blocks ON event_keys.block_number = blocks.number),
                     combined AS (SELECT *
                                  FROM relevant_updates
                                  UNION ALL
                                  SELECT *
                                  FROM relevant_swaps)

                SELECT *
                FROM combined
                ORDER BY block_number DESC, transaction_index DESC, event_index DESC
                LIMIT $3
            `,
      values: [token0, token1, limit],
    });
  }

  public getRevenueByToken({
    since = new Date(0),
    pair,
  }: {
    since?: Date;
    pair?: { token0: bigint; token1: bigint };
  }) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                WITH relevant_blocks AS (SELECT number
                                         FROM blocks
                                         WHERE time >= $1),
                     relevant_pool_keys AS (SELECT key_hash, token0, token1, fee
                                            FROM pool_keys
                                            WHERE COALESCE($2, token0) = token0
                                              AND COALESCE($3, token1) = token1),
                     token_fees_paid AS (SELECT relevant_pool_keys.token0  AS token,
                                                -protocol_fees_paid.delta0 AS delta
                                         FROM protocol_fees_paid
                                                  JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                  JOIN relevant_blocks
                                                       ON event_keys.block_number = relevant_blocks.number
                                                  JOIN
                                              relevant_pool_keys
                                              ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                         UNION ALL
                                         SELECT relevant_pool_keys.token1  AS token,
                                                -protocol_fees_paid.delta1 AS delta
                                         FROM protocol_fees_paid
                                                  JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                  JOIN relevant_blocks
                                                       ON event_keys.block_number = relevant_blocks.number
                                                  JOIN
                                              relevant_pool_keys
                                              ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash)
                SELECT token,
                       SUM(delta) AS revenue
                FROM token_fees_paid
                GROUP BY token_fees_paid.token
            `,
      values: [since, pair?.token0 ?? null, pair?.token1 ?? null],
    });
  }

  public getTvlByToken(pair?: { token0: bigint; token1: bigint }) {
    return this.client.query<{ token: string; balance: string }>({
      text: `
                SELECT token,
                       SUM(delta) AS balance
                FROM hourly_tvl_delta_by_token
                WHERE key_hash IN
                      (SELECT key_hash
                       FROM pool_keys
                       WHERE token0 = COALESCE($1, token0)
                         AND token1 = COALESCE($2, token1))
                GROUP BY token;
            `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null],
    });
  }

  public getTvlDeltaByTokenByDate(
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.client.query<{ token: string; date: string; balance: string }>({
      text: `
                SELECT token,
                       DATE_TRUNC('day', hour) AS date,
                       SUM(delta)              AS delta
                FROM hourly_tvl_delta_by_token
                WHERE hour >= $3
                  AND key_hash IN
                      (SELECT key_hash
                       FROM pool_keys
                       WHERE token0 = COALESCE($1, token0)
                         AND token1 = COALESCE($2, token1))
                GROUP BY token, date;
            `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async getVolatilityData({
    fromDate,
    pairs,
    numDays = 14,
  }: {
    fromDate: Date;
    pairs: { token0: bigint; token1: bigint }[];
    numDays?: number;
  }) {
    const { rows: volatilityData } = await this.client.query<{
      token0: string;
      token1: string;
      volatility_in_ticks: number;
    }>({
      text: `
                WITH times AS (SELECT $1::timestamptz                            AS "end",
                                      $1::timestamptz - ($2 * INTERVAL '1 days') AS start),

                     prices AS (SELECT pk.token0,
                                       pk.token1,
                                       date_bin(INTERVAL '1 hour', b.time,
                                                '2000-01-01 00:00:00'::TIMESTAMP WITHOUT TIME ZONE) AS period_start,
                                       SUM(delta1 * delta1) / SUM(ABS(delta1 * delta0))             AS price
                                FROM swaps s
                                         JOIN event_keys ek ON s.event_id = ek.id
                                         JOIN blocks b ON ek.block_number = b.number
                                         JOIN pool_keys pk ON s.pool_key_hash = pk.key_hash,
                                     times t
                                WHERE b.time >= t.start
                                  AND b.time < t.end
                                  AND delta1 != 0
                                  AND delta0 != 0
                                GROUP BY pk.token0, pk.token1, period_start),

                     log_price_changes AS (SELECT token0,
                                                  token1,
                                                  LN(price) -
                                                  LN(COALESCE(
                                                                  LAG(price) OVER (PARTITION BY token0, token1 ORDER BY period_start),
                                                                  price))                                   AS price_change,
                                                  EXTRACT(HOURS FROM period_start - COALESCE(LAG(period_start)
                                                                                             OVER (PARTITION BY token0, token1 ORDER BY period_start),
                                                                                             period_start)) AS hours_since_last
                                           FROM prices p,
                                                times t
                                           ORDER BY period_start),

                     realized_volatility_by_pair AS (SELECT token0,
                                                            token1,
                                                            STDDEV(lpc.price_change) * SQRT(SUM(hours_since_last)) AS realized_volatility
                                                     FROM log_price_changes lpc
                                                     GROUP BY token0, token1)

                SELECT token0,
                       token1,
                       int4(FLOOR(LOG(EXP(realized_volatility)) / LOG(1.000001::NUMERIC))) AS volatility_in_ticks
                FROM realized_volatility_by_pair
                WHERE (token0, token1) IN (
                    ${pairs
                      .map(
                        (p) => `(${p.token0}::numeric, ${p.token1}::numeric)`,
                      )
                      .join(", ")}
                    );
            `,
      values: [fromDate, numDays],
    });
    return volatilityData;
  }

  public async getVolumeWeightedPriceOverPeriod({
    baseToken,
    quoteToken,
    start,
    end,
    minSwapCount = 1,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    start?: Date;
    end?: Date;
    minSwapCount: number;
  }): Promise<{ price: Decimal; k_volume: bigint } | null> {
    if (baseToken === quoteToken)
      return { price: new Decimal(1), k_volume: 1n << 128n };

    const [token0, token1] =
      baseToken < quoteToken
        ? [baseToken, quoteToken]
        : [quoteToken, baseToken];

    const { rows } = await this.client.query<{
      total: string | null;
      k_volume: string | null;
      swap_count: number;
    }>({
      text: `
                SELECT SUM(delta1 * delta1) AS total, SUM(ABS(delta1 * delta0)) AS k_volume, COUNT(1) AS swap_count
                FROM swaps
                         JOIN pool_keys AS pk ON swaps.pool_key_hash = pk.key_hash
                         JOIN event_keys AS ek ON swaps.event_id = ek.id
                         JOIN blocks AS b ON ek.block_number = b.number
                WHERE token0 = $1
                  AND token1 = $2
                  AND delta1 != 0
                  AND delta0 != 0
                  AND b.time BETWEEN COALESCE($3, NOW() - INTERVAL '6 hours') AND COALESCE($4, NOW())
            `,
      values: [token0, token1, start, end],
    });

    if (rows.length !== 1) return null;

    const { total, k_volume, swap_count } = rows[0];

    if (
      total === null ||
      k_volume === null ||
      swap_count === null ||
      swap_count < minSwapCount
    )
      return null;

    const price =
      baseToken < quoteToken
        ? new Decimal(total).div(k_volume)
        : new Decimal(k_volume).div(total);
    return { price, k_volume: BigInt(k_volume) };
  }

  public getTotalVolumeByToken({
    since = new Date(0),
    pair,
  }: {
    since?: Date;
    pair?: { token0: bigint; token1: bigint };
  }) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                SELECT token,
                       SUM(volume) AS volume,
                       SUM(fees)   AS fees
                FROM hourly_volume_by_token
                WHERE hour >= $3
                  AND key_hash IN
                      (SELECT key_hash
                       FROM pool_keys
                       WHERE token0 = COALESCE($1, token0)
                         AND token1 = COALESCE($2, token1))
                GROUP BY token
            `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, since],
    });
  }

  public async getPriceHistory({
    token0,
    token1,
    start,
    end,
    intervalSeconds,
    decimalsDifference,
    delta0Threshold = 0n,
    delta1Threshold = 0n,
  }: {
    token0: bigint;
    token1: bigint;
    start: Date;
    end: Date;
    intervalSeconds: number;
    decimalsDifference: number;
    delta0Threshold?: bigint;
    delta1Threshold?: bigint;
  }) {
    if (token0 >= token1) throw new Error("invalid token0 and token1");

    const { rows } = await this.client.query<{
      start: string;
      vwap: number;
      min: number;
      max: number;
      k_volume: string;
    }>({
      text: `
                SELECT date_bin($5 * INTERVAL '1 sec', blocks.time,
                                '2000-01-01 00:00:00'::TIMESTAMP WITHOUT TIME ZONE)         AS start,
                       SUM(swaps.delta1 * swaps.delta1) / SUM(ABS(swaps.delta0 * swaps.delta1)) *
                       pow(10, $6)                                                          AS vwap,
                       MIN(CASE
                               WHEN ABS(swaps.delta0) > $7 AND ABS(swaps.delta1) > $8
                                   THEN ABS(swaps.delta1 / swaps.delta0) END) *
                       pow(10, $6)                                                          AS min,
                       MAX(CASE
                               WHEN ABS(swaps.delta0) > $7 AND ABS(swaps.delta1) > $8
                                   THEN ABS(swaps.delta1 / swaps.delta0) END) * pow(10, $6) AS max,
                       SUM(ABS(swaps.delta1 * swaps.delta0))                                AS k_volume
                FROM swaps
                         JOIN pool_keys
                              ON swaps.pool_key_hash = pool_keys.key_hash
                         JOIN event_keys ON swaps.event_id = event_keys.id
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE pool_keys.token0 = $1
                  AND pool_keys.token1 = $2
                  AND blocks.time BETWEEN $3 AND $4
                  AND swaps.delta0 != 0
                  AND swaps.delta1 != 0
                GROUP BY start
                ORDER BY start
            `,
      values: [
        token0,
        token1,
        start,
        end,
        intervalSeconds,
        decimalsDifference,
        delta0Threshold,
        delta1Threshold,
      ],
    });

    return rows;
  }

  public async getVolumeByTokenByDate(
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.client.query<{
      token: string;
      date: string;
      volume: string;
      fees: string;
    }>({
      text: `
                SELECT token,
                       DATE_TRUNC('day', hour) AS date,
                       SUM(volume)             AS volume,
                       SUM(fees)               AS fees
                FROM hourly_volume_by_token
                WHERE hour >= $3
                  AND key_hash IN
                      (SELECT key_hash
                       FROM pool_keys
                       WHERE token0 = COALESCE($1, token0)
                         AND token1 = COALESCE($2, token1))
                GROUP BY token, date
            `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async getAllVolumeWeightedPrices({
    start,
    quoteToken,
    minSwapCount,
  }: {
    start: Date;
    quoteToken: bigint;
    minSwapCount: number;
  }): Promise<{ token: string; price: Decimal; k_volume: bigint }[]> {
    const { rows } = await this.client.query<{
      token0: string;
      token1: string;
      total: string;
      k_volume: string;
      swap_count: number;
    }>({
      text: `
                SELECT token0,
                       token1,
                       SUM(delta1 * delta1)      AS total,
                       SUM(ABS(delta1 * delta0)) AS k_volume,
                       COUNT(1)                  AS swap_count
                FROM swaps
                         JOIN pool_keys AS pk ON swaps.pool_key_hash = pk.key_hash
                         JOIN event_keys AS ek ON swaps.event_id = ek.id
                         JOIN blocks AS b ON ek.block_number = b.number
                WHERE (token0 = $1
                    OR token1 = $1)
                  AND b.time >= $2
                GROUP BY token0, token1
            `,
      values: [quoteToken, start],
    });

    return rows
      .filter(
        ({ k_volume, total, swap_count }) =>
          BigInt(k_volume) > 0n &&
          BigInt(total) > 0n &&
          swap_count >= minSwapCount,
      )
      .map(({ token0, token1, k_volume, total }) => ({
        token: `0x${(BigInt(token0) === quoteToken
          ? BigInt(token1)
          : BigInt(token0)
        ).toString(16)}`,
        price:
          BigInt(token0) !== quoteToken
            ? new Decimal(total).div(k_volume)
            : new Decimal(k_volume).div(total),
        k_volume: BigInt(k_volume),
      }));
  }

  public async withinTransaction<T>(doX: () => Promise<T>): Promise<T> {
    await this.client.query(
      `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ`,
    );
    try {
      const result = await doX();
      await this.client.query(`ROLLBACK`);
      return result;
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "40001"
      ) {
        console.error("Serialization failure!", error);
      }
      throw error;
    }
  }

  public async getRevenueByTokenByDate(
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                WITH relevant_pool_keys AS (SELECT key_hash, token0, token1, fee
                                            FROM pool_keys
                                            WHERE COALESCE($1, token0) = token0
                                              AND COALESCE($2, token1) = token1),
                     revenue_deltas AS (SELECT relevant_pool_keys.token0  AS token,
                                               date(blocks.time)          AS date,
                                               -protocol_fees_paid.delta0 AS delta
                                        FROM protocol_fees_paid
                                                 JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                 JOIN blocks
                                                      ON event_keys.block_number = blocks.number
                                        WHERE blocks.time >= $3
                                        UNION ALL
                                        SELECT relevant_pool_keys.token1  AS token,
                                               date(blocks.time)          AS date,
                                               -protocol_fees_paid.delta1 AS delta
                                        FROM protocol_fees_paid
                                                 JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                 JOIN blocks
                                                      ON event_keys.block_number = blocks.number
                                        WHERE blocks.time >= $3)

                SELECT token,
                       date,
                       SUM(delta) AS revenue
                FROM revenue_deltas
                GROUP BY token, date
                ORDER BY token, date;
            `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async getTopPairs(since: Date = new Date(Date.now() - 86_400_000)) {
    return this.client.query({
      text: `
                WITH volume AS (SELECT token0,
                                       token1,
                                       SUM(CASE WHEN token0 = vbt.token THEN volume ELSE 0 END) AS volume0,
                                       SUM(CASE WHEN token1 = vbt.token THEN volume ELSE 0 END) AS volume1,
                                       SUM(CASE WHEN token0 = vbt.token THEN fees ELSE 0 END)   AS fees0,
                                       SUM(CASE WHEN token1 = vbt.token THEN fees ELSE 0 END)   AS fees1
                                FROM hourly_volume_by_token vbt
                                         INNER JOIN pool_keys ON vbt.key_hash = pool_keys.key_hash
                                WHERE hour >= $1
                                GROUP BY token0, token1),
                     tvl_total AS (SELECT token0,
                                          token1,
                                          SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                   FROM hourly_tvl_delta_by_token tvd
                                            JOIN pool_keys ON pool_keys.key_hash = tvd.key_hash
                                   GROUP BY token0, token1),
                     tvl_delta_24h AS (SELECT token0,
                                              token1,
                                              SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                       FROM hourly_tvl_delta_by_token tvd
                                                JOIN pool_keys ON pool_keys.key_hash = tvd.key_hash
                                       WHERE hour >= $1
                                       GROUP BY token0, token1)
                SELECT COALESCE(volume.token0, tvl_total.token0) AS token0,
                       COALESCE(volume.token1, tvl_total.token1) AS token1,
                       COALESCE(volume.volume0, 0)               AS volume0_24h,
                       COALESCE(volume.volume1, 0)               AS volume1_24h,
                       COALESCE(volume.fees0, 0)                 AS fees0_24h,
                       COALESCE(volume.fees1, 0)                 AS fees1_24h,
                       COALESCE(tvl_total.tvl0, 0)               AS tvl0_total,
                       COALESCE(tvl_total.tvl1, 0)               AS tvl1_total,
                       COALESCE(tvl_delta_24h.tvl0, 0)           AS tvl0_delta_24h,
                       COALESCE(tvl_delta_24h.tvl1, 0)           AS tvl1_delta_24h
                FROM volume
                         FULL OUTER JOIN
                     tvl_total ON volume.token0 = tvl_total.token0 AND volume.token1 = tvl_total.token1
                         FULL OUTER JOIN tvl_delta_24h
                                         ON tvl_delta_24h.token0 = COALESCE(volume.token0, tvl_total.token0) AND
                                            tvl_delta_24h.token1 = COALESCE(volume.token1, tvl_total.token1);
            `,
      values: [since],
    });
  }

  public async getTopPools(pair: { token0: bigint; token1: bigint }) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                WITH relevant_pool_keys AS (SELECT key_hash, token0, token1, fee, tick_spacing, extension
                                            FROM pool_keys
                                            WHERE token0 = $1
                                              AND token1 = $2),
                     volume AS (SELECT vbt.key_hash,
                                       SUM(CASE WHEN vbt.token = token0 THEN vbt.volume ELSE 0 END) AS volume0,
                                       SUM(CASE WHEN vbt.token = token1 THEN vbt.volume ELSE 0 END) AS volume1,
                                       SUM(CASE WHEN vbt.token = token0 THEN vbt.fees ELSE 0 END)   AS fees0,
                                       SUM(CASE WHEN vbt.token = token1 THEN vbt.fees ELSE 0 END)   AS fees1
                                FROM hourly_volume_by_token vbt
                                         JOIN relevant_pool_keys ON vbt.key_hash = relevant_pool_keys.key_hash
                                WHERE hour >= $3
                                GROUP BY vbt.key_hash),
                     tvl_total AS (SELECT tbt.key_hash,
                                          SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                   FROM hourly_tvl_delta_by_token tbt
                                            JOIN pool_keys pk ON tbt.key_hash = pk.key_hash
                                   GROUP BY tbt.key_hash),
                     tvl_delta_24h AS (SELECT tbt.key_hash,
                                              SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                       FROM hourly_tvl_delta_by_token tbt
                                                JOIN pool_keys pk ON tbt.key_hash = pk.key_hash
                                       WHERE hour >= $3
                                       GROUP BY tbt.key_hash)
                SELECT relevant_pool_keys.fee,
                       relevant_pool_keys.tick_spacing,
                       relevant_pool_keys.extension,
                       COALESCE(volume.volume0, 0)     AS volume0_24h,
                       COALESCE(volume.volume1, 0)     AS volume1_24h,
                       COALESCE(volume.fees0, 0)       AS fees0_24h,
                       COALESCE(volume.fees1, 0)       AS fees1_24h,
                       COALESCE(tvl_total.tvl0, 0)     AS tvl0_total,
                       COALESCE(tvl_total.tvl1, 0)     AS tvl1_total,
                       COALESCE(tvl_delta_24h.tvl0, 0) AS tvl0_delta_24h,
                       COALESCE(tvl_delta_24h.tvl1, 0) AS tvl1_delta_24h
                FROM volume
                         FULL OUTER JOIN
                     tvl_total ON volume.key_hash = tvl_total.key_hash
                         FULL OUTER JOIN tvl_delta_24h
                                         ON tvl_delta_24h.key_hash = COALESCE(volume.key_hash, tvl_total.key_hash)
                         JOIN relevant_pool_keys
                              ON COALESCE(volume.key_hash, tvl_total.key_hash) = relevant_pool_keys.key_hash;
            `,
      values: [pair.token0, pair.token1, new Date(Date.now() - 86_400_000)],
    });
  }

  public async getPositionsByAddress(address: bigint, showClosed: boolean) {
    return this.client.query<
      PositionMetadata & {
        token_id: string;
        points_earned: string;
      }
    >({
      text: `
                WITH owned_tokens AS (SELECT token_id
                                      FROM position_transfers pt1
                                      WHERE to_address = $1
                                        AND NOT EXISTS (SELECT 1
                                                        FROM position_transfers pt2
                                                        WHERE pt2.token_id = pt1.token_id
                                                          AND pt2.event_id > pt1.event_id
                                                          AND (CASE WHEN $2 THEN pt2.to_address != 0 ELSE TRUE END))),
                     filtered_owned_tokens AS (SELECT token_id, SUM(liquidity_delta) AS liquidity
                                               FROM owned_tokens
                                                        JOIN position_updates
                                                             ON token_id::NUMERIC = salt
                                               GROUP BY token_id)
                SELECT token_id,
                       event_keys.transaction_hash      AS minted_tx_hash,
                       token0,
                       token1,
                       fee,
                       tick_spacing,
                       extension,
                       lower_bound,
                       upper_bound,
                       blocks.time                      AS minted_timestamp,
                       (SELECT SUM(points)
                        FROM leaderboard AS l
                        WHERE l.collector = $1
                          AND l.token_id = ot.token_id) AS points_earned
                FROM filtered_owned_tokens AS ot
                         LEFT JOIN LATERAL (
                    SELECT lower_bound, upper_bound, pool_key_hash
                    FROM position_updates AS pu
                    WHERE pu.salt = token_id::NUMERIC
                    LIMIT 1
                    ) AS mint_position_update ON TRUE
                         LEFT JOIN LATERAL (
                    SELECT event_id
                    FROM position_transfers AS pt
                    WHERE pt.token_id = ot.token_id
                    ORDER BY event_id ASC
                    LIMIT 1
                    ) AS mint_tx ON TRUE
                         JOIN event_keys ON mint_tx.event_id = event_keys.id
                         JOIN pool_keys ON mint_position_update.pool_key_hash = pool_keys.key_hash
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE ($2 OR ot.liquidity > 0)
                ORDER BY token_id DESC
            `,
      values: [address, showClosed],
    });
  }

  public async getTwammOrdersByAddress(address: bigint, showClosed: boolean) {
    return this.client.query<
      TwammOrderMetadata & {
        token_id: string;
      }
    >({
      text: `
                WITH owned_tokens AS (SELECT token_id
                                      FROM position_transfers pt1
                                      WHERE to_address = $1
                                        AND NOT EXISTS (SELECT 1
                                                        FROM position_transfers pt2
                                                        WHERE pt2.token_id = pt1.token_id
                                                          AND pt2.event_id > pt1.event_id
                                                          AND (CASE WHEN $2 THEN pt2.to_address != 0 ELSE TRUE END)))
                SELECT token_id,
                       sell_token,
                       buy_token,
                       start_time,
                       end_time,
                       fee,
                       block_time_at_start,
                       last_order_update,
                       (SELECT b2.time
                        FROM twamm_proceeds_withdrawals tpw
                                 JOIN event_keys ek2 ON tpw.event_id = ek2.id
                                 JOIN blocks b2 ON ek2.block_number = b2.number
                        WHERE tpw.salt = ot.token_id::NUMERIC
                        ORDER BY tpw.event_id DESC
                        LIMIT 1)   AS last_collect_proceeds,
                       COALESCE((SELECT SUM(points) FROM leaderboard l WHERE l.token_id = ot.token_id AND category = 3),
                                0) AS points
                FROM owned_tokens AS ot
                         JOIN LATERAL (
                    SELECT (CASE WHEN tou.sale_rate_delta0 != 0 THEN token0 ELSE token1 END) AS sell_token,
                           (CASE WHEN tou.sale_rate_delta0 != 0 THEN token1 ELSE token0 END) AS buy_token,
                           start_time,
                           end_time,
                           fee,
                           MIN(b.time)                                                       AS block_time_at_start,
                           MAX(b.time)                                                       AS last_order_update
                    FROM twamm_order_updates AS tou
                             JOIN pool_keys ON tou.key_hash = pool_keys.key_hash
                             JOIN event_keys ek ON tou.event_id = ek.id
                             JOIN blocks b ON ek.block_number = b.number
                    WHERE tou.salt = token_id::NUMERIC
                    GROUP BY 1, 2, 3, 4, 5
                    ) AS distinct_orders ON TRUE
                ORDER BY token_id DESC
            `,
      values: [address, showClosed],
    });
  }

  public async getLeaderboard({
    collector,
    pageSize,
    start,
  }: {
    collector?: bigint;
    pageSize: number;
    start: number;
  }) {
    return this.client.query<{
      rank: string;
      collector: string;
      earned_points: string;
      referral_points: string;
      total_points: string;
    }>({
      text: `
                SELECT rank, collector, earned_points, referral_points, total_points
                FROM leaderboard_materialized_view
                WHERE (collector = $1 OR $1 IS NULL)
                ORDER BY rank
                LIMIT $2 OFFSET $3
            `,
      values: [collector ?? null, pageSize, start],
    });
  }

  public async getLeaderboardCount(): Promise<number> {
    const { rows } = await this.client.query<{
      count: string;
    }>(`
            SELECT COUNT(1) AS count
            FROM leaderboard_materialized_view
        `);
    return Number(rows[0].count);
  }

  async getPoolKey(poolKeyHash: bigint) {
    const { rows } = await this.client.query<{
      token0: string;
      token1: string;
      fee: string;
      tick_spacing: number;
      extension: string;
    }>({
      text: `SELECT token0, token1, fee, tick_spacing, extension
                   FROM pool_keys
                   WHERE key_hash = $1`,
      values: [poolKeyHash],
    });
    if (rows.length !== 1) {
      throw new Error("Invalid pool key hash");
    }
    return rows[0];
  }

  async getAllDrops({ token }: { token?: bigint | null }) {
    const { rows } = await this.client.query<{
      contract_address: string;
      start_date: string;
      end_date: string;
      token: string;
    }>({
      text: `
                SELECT address AS contract_address,
                       gd.start_date,
                       gd.end_date,
                       token
                FROM deployed_airdrop_contracts da
                         JOIN generated_drop gd ON da.drop_id = gd.id
                WHERE da.token = COALESCE($1, da.token)
            `,
      values: [token ?? null],
    });
    return rows;
  }

  async getClaimsWithProofs({
    forAddress,
    token,
  }: {
    forAddress: bigint;
    token?: bigint | null;
  }) {
    const { rows } = await this.client.query<{
      contract_address: string;
      start_date: string;
      end_date: string;
      token: string;
      claim_id: number;
      amount: string;
      proof: string[];
    }>({
      text: `
                SELECT address           AS contract_address,
                       gd.start_date,
                       gd.end_date,
                       token,
                       gdp.id            AS claim_id,
                       gdp.amount        AS amount,
                       gdp.proof::TEXT[] AS proof
                FROM deployed_airdrop_contracts da
                         JOIN generated_drop gd ON da.drop_id = gd.id
                         JOIN generated_drop_proof gdp ON gd.id = gdp.drop_id
                WHERE gdp.claimee = $1
                  AND da.token = COALESCE($2, token)
            `,
      values: [forAddress, token],
    });
    return rows;
  }

  async getClaimsBetween({
    claimContract,
    startingId,
    endingId,
  }: {
    claimContract: bigint;
    startingId: number;
    endingId: number;
  }) {
    const { rows } = await this.client.query<{
      claim_id: number;
      claimee: string;
      amount: string;
      proof: string[];
    }>({
      text: `
                SELECT gdp.id            AS claim_id,
                       gdp.claimee       AS claimee,
                       gdp.amount        AS amount,
                       gdp.proof::TEXT[] AS proof
                FROM deployed_airdrop_contracts da
                         JOIN generated_drop gd ON da.drop_id = gd.id
                         JOIN generated_drop_proof gdp ON gd.id = gdp.drop_id
                WHERE da.address = $1
                  AND gdp.id BETWEEN $2 AND $3
            `,
      values: [claimContract, startingId, endingId],
    });
    return rows;
  }

  async getAllocations({
    owner,
    start,
    end,
  }: {
    owner: bigint;
    start: Date;
    end: Date;
  }) {
    const { rows } = await this.client.query<{
      token_id: string;
      day: string;
      incentives: string;
    }>({
      text: `
                WITH owned_tokens AS (SELECT token_id
                                      FROM position_transfers pt1
                                      WHERE to_address = $1
                                        AND NOT EXISTS (SELECT 1
                                                        FROM position_transfers pt2
                                                        WHERE pt2.token_id = pt1.token_id
                                                          AND pt2.event_id > pt1.event_id
                                                          AND pt2.to_address != 0))
                SELECT token_id,
                       day,
                       incentives
                FROM owned_tokens
                         JOIN strk_defi_spring_incentives ON salt = token_id::NUMERIC
                WHERE day BETWEEN $2 AND $3
            `,
      values: [owner, start, end],
    });
    return rows;
  }

  async getAllocationsForToken({ tokenId }: { tokenId: bigint }) {
    const { rows } = await this.client.query<{
      day: string;
      incentives: string;
    }>({
      values: [tokenId],
      text: `
                SELECT day,
                       incentives AS incentives
                FROM strk_defi_spring_incentives
                WHERE salt = $1
            `,
    });
    return rows;
  }

  async getAverageSwapCostOverLastPeriod({ since }: { since: Date }) {
    const { rows } = await this.client.query<{
      count: string;
      fee_paid_unit: 0 | 1 | 2;
      avg_fee_paid: string;
    }>({
      text: `
                SELECT COUNT(1) AS count, tr.fee_paid_unit, AVG(tr.fee_paid) AS avg_fee_paid
                FROM event_keys ek
                         JOIN transaction_receipts tr ON ek.transaction_hash = tr.transaction_hash
                WHERE id >= (SELECT id
                             FROM event_keys
                             WHERE block_number <=
                                   (SELECT number
                                    FROM blocks
                                    WHERE time < $1
                                    ORDER BY number DESC
                                    LIMIT 1)
                             ORDER BY id DESC
                             LIMIT 1)
                  AND id IN (SELECT event_id FROM swaps)
                GROUP BY tr.fee_paid_unit
            `,
      values: [since],
    });
    return rows;
  }

  async getLatestBlockMeta() {
    const { rows } = await this.client.query<{ number: number; time: Date }>(
      `SELECT number, time
             FROM blocks
             ORDER BY number DESC
             LIMIT 1`,
    );
    if (!rows.length) throw new Error("No blocks");
    return rows[0];
  }

  async getAverageBlockTime() {
    const { rows } = await this.client.query<{ average_block_time: number }>(`
            WITH blocks_and_last_time
                     AS (SELECT time, LAG(time) OVER (ORDER BY number) AS last_time
                         FROM blocks
                         WHERE time >= NOW() - INTERVAL '3 hour')
            SELECT FLOOR(AVG(EXTRACT(EPOCH FROM (time - last_time))))::int4 AS average_block_time
            FROM blocks_and_last_time
        `);
    return rows[0]?.average_block_time ?? 360;
  }

  getProposals() {
    return this.client.query<{
      id: string;
      description: string | null;
      calls: { to: string; selector: string; calldata: string[] }[] | null;
      results: string[][] | null;
      created_time: number;
      canceled_time: number | null;
      executed_time: number | null;
    }>(`
      SELECT gp.id,
             (SELECT description
              FROM governor_proposal_described gpd
              WHERE gpd.id = gp.id
              ORDER BY event_id DESC
              LIMIT 1)                               AS description,
             (SELECT JSONB_AGG(
                         JSONB_BUILD_OBJECT('to', to_address::TEXT, 'selector', selector::TEXT, 'calldata', calldata::TEXT[])
                         ORDER BY index)
              FROM governor_proposed_calls gpc
              WHERE gpc.proposal_id = gp.id)         AS calls,
             (SELECT JSONB_AGG(
                         results::TEXT[]
                         ORDER BY index)
              FROM governor_executed_results ger
              WHERE ger.proposal_id = gp.id)         AS results,
             FLOOR(EXTRACT(EPOCH FROM b.time))::int4 AS created_time,
             (SELECT FLOOR(EXTRACT(EPOCH FROM b2.time))::int4
              FROM governor_canceled gc
                     JOIN event_keys e2 ON gc.event_id = e2.id
                     JOIN blocks b2 ON e2.block_number = b2.number
              WHERE gc.id = gp.id)                      canceled_time,
             (SELECT FLOOR(EXTRACT(EPOCH FROM b2.time))::int4
              FROM governor_executed ge
                     JOIN event_keys e2 ON ge.event_id = e2.id
                     JOIN blocks b2 ON e2.block_number = b2.number
              WHERE ge.id = gp.id)                      executed_time
      FROM governor_proposed gp
             JOIN event_keys ek ON event_id = ek.id
             JOIN blocks b ON block_number = b.number
      ORDER BY created_time DESC
    `);
  }

  getVotesOnProposal({ proposalId }: { proposalId: bigint }) {
    return this.client.query<{
      time: number;
      voter: string;
      weight: string;
      yea: boolean;
    }>({
      text: `
        SELECT FLOOR(EXTRACT(EPOCH FROM b.time))::int4 AS time, voter, weight, yea
        FROM governor_voted
        JOIN event_keys ek ON event_id = ek.id
        JOIN blocks b ON block_number = b.number
        WHERE id = $1
      `,
      values: [proposalId],
    });
  }

  getTopDelegates({ limit }: { limit: number }) {
    return this.client.query<{ delegate: string; amount: string }>({
      text: `
        WITH staker_delegation_changes AS (SELECT amount, delegate
                                           FROM staker_staked
                                           UNION ALL
                                           SELECT -amount AS amount, delegate
                                           FROM staker_withdrawn)
        SELECT delegate,
               SUM(amount) AS amount
        FROM staker_delegation_changes
        GROUP BY delegate
        ORDER BY 2 DESC
        LIMIT $1
      `,
      values: [limit],
    });
  }

  getDelegatesStakedTo({ staker }: { staker: bigint }) {
    return this.client.query<{ delegate: string; amount: string }>({
      text: `
          WITH staker_delegation_changes AS (SELECT amount, delegate
                                             FROM staker_staked
                                             WHERE from_address = $1
                                             UNION ALL
                                             SELECT -amount AS amount, delegate
                                             FROM staker_withdrawn
                                             WHERE from_address = $1)
          SELECT delegate,
                 SUM(amount) AS amount
          FROM staker_delegation_changes
          GROUP BY delegate
          ORDER BY 2 DESC
      `,
      values: [staker],
    });
  }
}

export async function createQueries(env: Env) {
  const client = new Client({
    connectionString:
      env.HYPERDRIVE?.connectionString ?? env.PG_CONNECTION_STRING,
    ssl: !!env.HYPERDRIVE,
  });
  await client.connect();
  return new Queries(client);
}
