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

  public async getLatestBlock() {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
          SELECT number, hash, time AS timestamp
          FROM blocks
          ORDER BY number DESC
          LIMIT 1
      `,
      values: [],
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getBlock(blockNumber: number) {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
          SELECT number, time AS timestamp
          FROM blocks
          WHERE number = $1
      `,
      values: [blockNumber],
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

  public async getRegisteredTokens() {
    return this.client.query<{
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      total_supply: string;
    }>(`SELECT address, name, symbol, decimals, total_supply
        FROM latest_token_registrations`);
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
    const { rows } = await this.client.query<{
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
      last_owner: string;
    }>({
      text: `
          SELECT to_address AS last_owner
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
          FROM per_pool_per_tick_liquidity_incremental_view
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
          FROM per_pool_per_tick_liquidity_incremental_view
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
      event_id: string;

      delta0: string;
      delta1: string;
    }>({
      text: `
          WITH earliest_event AS (SELECT id
                                  FROM event_keys ek
                                  WHERE ek.block_number = (SELECT number
                                                           FROM blocks
                                                           WHERE time >= NOW() - INTERVAL '1 days'
                                                           ORDER BY number
                                                           LIMIT 1)
                                  ORDER BY id
                                  LIMIT 1),

               relevant_pool_keys AS (SELECT key_hash, fee, extension, tick_spacing
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
                                         event_id,
                                         locker,
                                         delta0,
                                         delta1
                                  FROM swaps
                                           JOIN relevant_pool_keys ON key_hash = pool_key_hash
                                           JOIN event_keys ON swaps.event_id = event_keys.id
                                           JOIN blocks ON event_keys.block_number = blocks.number,
                                       earliest_event
                                  WHERE event_id >= earliest_event.id),
               relevant_updates AS (SELECT 1                           AS type,
                                           relevant_pool_keys.key_hash AS pool_key_hash,
                                           relevant_pool_keys.fee,
                                           relevant_pool_keys.tick_spacing,
                                           relevant_pool_keys.extension,
                                           blocks.time                 AS timestamp,
                                           transaction_hash,
                                           event_id,
                                           locker,
                                           delta0,
                                           delta1
                                    FROM position_updates
                                             JOIN relevant_pool_keys
                                                  ON key_hash = pool_key_hash
                                             JOIN event_keys ON position_updates.event_id = event_keys.id
                                             JOIN blocks ON event_keys.block_number = blocks.number,
                                         earliest_event
                                    WHERE event_id >= earliest_event.id),
               combined AS (SELECT *
                            FROM relevant_updates
                            UNION ALL
                            SELECT *
                            FROM relevant_swaps)

          SELECT *
          FROM combined
          ORDER BY event_id DESC
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
    if (!pair && !since) {
      return this.client.query<{ token: string; revenue: string }>(`
          SELECT token,
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token
          GROUP BY token
      `);
    }

    if (!pair) {
      return this.client.query<{ token: string; revenue: string }>({
        text: `
            SELECT token,
                   SUM(revenue) AS revenue
            FROM hourly_revenue_by_token
            WHERE hour >= $1
            GROUP BY token
        `,
        values: [since],
      });
    }

    return this.client.query<{ token: string; revenue: string }>({
      text: `
          SELECT hrbt.token,
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token hrbt
                   JOIN pool_keys pk ON pk.key_hash = hrbt.key_hash
          WHERE hrbt.hour >= $1
            AND pk.token0 = $2
            AND pk.token1 = $3
          GROUP BY hrbt.token
      `,
      values: [since, pair.token0, pair.token1],
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
                 DATE_TRUNC('day', hour, 'UTC') AS date,
                 SUM(delta)                     AS delta
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

  public async getVolumeWeightedPrice({
    baseToken,
    quoteToken,
    endTime = new Date(),
    numHours = 6,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    endTime?: Date;
    numHours?: number;
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
          SELECT SUM(total) AS total, SUM(k_volume) AS k_volume, SUM(swap_count) AS swap_count
          FROM hourly_price_data
          WHERE token0 = $1
            AND token1 = $2
            AND hour BETWEEN (DATE_TRUNC('hour', $3::timestamptz - ($4 * INTERVAL '1 hour'), 'UTC')) AND DATE_TRUNC('hour', $3::timestamptz, 'UTC')
      `,
      values: [token0, token1, endTime, numHours],
    });

    if (rows.length !== 1) return null;

    const { total, k_volume, swap_count } = rows[0];

    if (!total || !k_volume || !swap_count) return null;

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
                 DATE_TRUNC('day', hour, 'UTC') AS date,
                 SUM(volume)                    AS volume,
                 SUM(fees)                      AS fees
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
    if (!pair)
      return this.client.query<{ token: string; volume: string }>({
        text: `
          SELECT token,
                 DATE_TRUNC('day', hour, 'UTC'),
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token
          WHERE hour >= $1
          GROUP BY 1, 2
          ORDER BY 1, 2;
      `,
        values: [after],
      });

    return this.client.query<{ token: string; volume: string }>({
      text: `
          SELECT token,
                 DATE_TRUNC('day', hour, 'UTC'),
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token hrbt
                   JOIN pool_keys pk ON pk.key_hash = hrbt.key_hash
          WHERE hour >= $1
            AND pk.token0 = $2
            AND pk.token1 = $3
          GROUP BY 1, 2
          ORDER BY 1, 2;
      `,
      values: [after, pair.token0, pair.token1],
    });
  }

  public async getTopPairs() {
    return this.client.query<{
      token0: string;
      token1: number;
      volume0_24h: string;
      volume1_24h: string;
      fees0_24h: string;
      fees1_24h: string;
      tvl0_total: string;
      tvl1_total: string;
      tvl0_delta_24h: string;
      tvl1_delta_24h: string;
    }>(`
        SELECT pk.token0,
               pk.token1,
               SUM(volume0_24h)    AS volume0_24h,
               SUM(volume1_24h)    AS volume1_24h,
               SUM(fees0_24h)      AS fees0_24h,
               SUM(fees1_24h)      AS fees1_24h,
               SUM(tvl0_total)     AS tvl0_total,
               SUM(tvl1_total)     AS tvl1_total,
               SUM(tvl0_delta_24h) AS tvl0_delta_24h,
               SUM(tvl1_delta_24h) AS tvl1_delta_24h
        FROM last_24h_pool_stats_materialized l24
                 JOIN pool_keys pk ON l24.key_hash = pk.key_hash
        WHERE volume0_24h != 0
           OR volume1_24h != 0
           OR tvl0_total != 0
           OR tvl1_total != 0
        GROUP BY pk.token0, pk.token1;
    `);
  }

  public async getTopPools(pair: { token0: bigint; token1: bigint }) {
    return this.client.query<{
      fee: string;
      tick_spacing: number;
      extension: string;
      volume0_24h: string;
      volume1_24h: string;
      fees0_24h: string;
      fees1_24h: string;
      tvl0_total: string;
      tvl1_total: string;
      tvl0_delta_24h: string;
      tvl1_delta_24h: string;
    }>({
      text: `
          SELECT p.fee,
                 p.tick_spacing,
                 p.extension,
                 volume0_24h,
                 volume1_24h,
                 fees0_24h,
                 fees1_24h,
                 tvl0_total,
                 tvl1_total,
                 tvl0_delta_24h,
                 tvl1_delta_24h
          FROM last_24h_pool_stats_materialized l24
                   JOIN pool_keys p ON l24.key_hash = p.key_hash

          WHERE p.token0 = $1
            AND p.token1 = $2
            AND (
              volume0_24h != 0
                  OR volume1_24h != 0
                  OR tvl0_total != 0
                  OR tvl1_total != 0
              );
          ;
      `,
      values: [pair.token0, pair.token1],
    });
  }

  public async getPositionsByAddress(address: bigint, showClosed: boolean) {
    return this.client.query<
      PositionMetadata & {
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
                                                    AND (CASE WHEN $2 THEN pt2.to_address != 0 ELSE TRUE END))),
               filtered_owned_tokens AS (SELECT token_id, SUM(liquidity_delta) AS liquidity
                                         FROM owned_tokens
                                                  JOIN position_updates
                                                       ON token_id::NUMERIC = salt
                                         GROUP BY token_id)
          SELECT token_id,
                 event_keys.transaction_hash AS minted_tx_hash,
                 token0,
                 token1,
                 fee,
                 tick_spacing,
                 extension,
                 lower_bound,
                 upper_bound,
                 blocks.time                 AS minted_timestamp
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
    return this.client.query<{
      token_id: string;
      sell_token: string;
      buy_token: string;
      start_time: Date;
      end_time: Date;
      fee: string;
      block_time_at_start: Date;
      last_order_update: Date;
      last_collect_proceeds: Date | null;
      total_proceeds_withdrawn: string;
      total_amount_sold_before_last_update: string;
    }>({
      text: `
          WITH owned_tokens AS (SELECT token_id
                                FROM position_transfers pt1
                                WHERE to_address = $1
                                  AND NOT EXISTS (SELECT 1
                                                  FROM position_transfers pt2
                                                  WHERE pt2.token_id = pt1.token_id
                                                    AND pt2.event_id > pt1.event_id
                                                    AND (CASE WHEN $2 THEN pt2.to_address != 0 ELSE TRUE END))),
               order_updates_with_seconds_passed AS (SELECT event_id,
                                                            SUM(CASE
                                                                    WHEN sale_rate_delta1 != 0 THEN sale_rate_delta1
                                                                    ELSE sale_rate_delta0 END) OVER (
                                                                PARTITION BY tou.salt, tou.key_hash, tou.start_time, tou.end_time, tou.owner ORDER BY tou.event_id
                                                                )              AS sale_rate_after_update,
                                                            -- the number of seconds that the order was active at the previous state before this update
                                                            COALESCE(
                                                                            LEAD(EXTRACT(EPOCH FROM
                                                                                         LEAST(GREATEST(b.time, tou.start_time), tou.end_time)))
                                                                            OVER (PARTITION BY tou.salt, tou.key_hash, tou.start_time, tou.end_time, tou.owner ORDER BY tou.event_id) -
                                                                            EXTRACT(EPOCH FROM
                                                                                    LEAST(GREATEST(b.time, tou.start_time), tou.end_time)),
                                                                            0) AS current_state_active_seconds
                                                     FROM twamm_order_updates tou
                                                              JOIN event_keys e ON tou.event_id = e.id
                                                              JOIN blocks b ON e.block_number = b.number)
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
                  LIMIT 1)                    AS last_collect_proceeds,
                 tpw.total_proceeds_withdrawn AS total_proceeds_withdrawn,
                 tas.total_amount_sold_before_last_update        AS total_amount_sold_before_last_update
          FROM owned_tokens AS ot
                   JOIN LATERAL (
              SELECT tou.key_hash,
                     (CASE WHEN tou.sale_rate_delta0 != 0 THEN token0 ELSE token1 END) AS sell_token,
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
              GROUP BY 1, 2, 3, 4, 5, 6
              ) AS distinct_orders ON TRUE
                   LEFT JOIN LATERAL (
              SELECT SUM(CASE WHEN tpw.amount0 != 0 THEN tpw.amount0 ELSE tpw.amount1 END) total_proceeds_withdrawn
              FROM twamm_proceeds_withdrawals tpw
              WHERE tpw.salt = ot.token_id::NUMERIC
                AND tpw.key_hash = distinct_orders.key_hash
                AND tpw.start_time = distinct_orders.start_time
                AND tpw.end_time = distinct_orders.end_time
              ) AS tpw ON TRUE
                   LEFT JOIN LATERAL (
              SELECT SUM(
                             FLOOR(ouwsp.sale_rate_after_update *
                                   ouwsp.current_state_active_seconds / pow(2, 32)::numeric)
                     ) AS total_amount_sold_before_last_update
              FROM twamm_order_updates tou
                       JOIN order_updates_with_seconds_passed ouwsp ON tou.event_id = ouwsp.event_id
              WHERE tou.salt = ot.token_id::NUMERIC
                AND tou.key_hash = distinct_orders.key_hash
                AND tou.start_time = distinct_orders.start_time
                AND tou.end_time = distinct_orders.end_time
              ) AS tas ON TRUE
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

  getProposals() {
    return this.client.query<{
      id: string;
      created: number;
      description: string | null;
      calls: { to: string; selector: string; calldata: string[] }[] | null;
      results: string[][] | null;
    }>(`
        SELECT gp.id,
               gp.proposer                      AS proposer,
               (SELECT description
                FROM governor_proposal_described gpd
                WHERE gpd.id = gp.id
                ORDER BY event_id DESC
                LIMIT 1)                        AS description,
               EXTRACT(EPOCH FROM b.time)::int4 AS created,
               (SELECT JSONB_AGG(
                               JSONB_BUILD_OBJECT('to', to_address::TEXT, 'selector', selector::TEXT, 'calldata',
                                                  calldata::TEXT[])
                               ORDER BY index)
                FROM governor_proposed_calls gpc
                WHERE gpc.proposal_id = gp.id)  AS calls,
               (SELECT JSONB_AGG(
                               results::TEXT[]
                               ORDER BY index)
                FROM governor_executed_results ger
                WHERE ger.proposal_id = gp.id)  AS results
        FROM governor_proposed gp
                 JOIN event_keys ek ON event_id = ek.id
                 JOIN blocks b ON block_number = b.number
        WHERE gp.id NOT IN (SELECT id FROM governor_canceled)
        ORDER BY b.time DESC
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
          FROM governor_voted gv
                   JOIN event_keys ek ON event_id = ek.id
                   JOIN blocks b ON block_number = b.number
          WHERE gv.id = $1
      `,
      values: [proposalId],
    });
  }

  getTopDelegates({ pageSize, start }: { pageSize: number; start: number }) {
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
          LIMIT $1 OFFSET $2
      `,
      values: [pageSize, start],
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
                                             WHERE from_address = $1),
               summed AS (SELECT delegate,
                                 SUM(amount) AS amount
                          FROM staker_delegation_changes
                          GROUP BY delegate)
          SELECT delegate, amount
          FROM summed
          WHERE amount != 0
          ORDER BY amount DESC
      `,
      values: [staker],
    });
  }

  async getAmountDelegatedTo({ delegate }: { delegate: bigint }) {
    const { rows } = await this.client.query<{
      amount_delegated: string;
    }>({
      text: `
          SELECT COALESCE((SELECT SUM(amount)
                           FROM staker_staked
                           WHERE delegate = $1), 0::NUMERIC) - COALESCE(
                         (SELECT SUM(amount)
                          FROM staker_withdrawn
                          WHERE delegate = $1), 0::NUMERIC) as amount_delegated
      `,
      values: [delegate],
    });

    return BigInt(rows[0]?.amount_delegated ?? 0);
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
