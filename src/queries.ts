import { Client } from "pg";
import Decimal from "decimal.js-light";
import { Tick } from "./routes/quote/nodes/plainPool";

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

export interface PoolState {
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
}

export class Queries {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async getLatestBlock() {
    const { rows } = await this.client.query<{
      number: string;
      hash: string;
      timestamp: string;
    }>(`
            SELECT number, hash, timestamp
            FROM blocks
            ORDER BY number DESC
            LIMIT 1
        `);
    if (rows.length !== 1) throw new Error("No blocks");
    return rows[0];
  }

  public async getAllPoolsWithStates() {
    return this.client.query<PoolState>(`
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

  // Returns all pools containing either tokenA or tokenB and their states
  public async getAllRoutablePools({
    tokenA,
    tokenB,
    extension = 0n,
  }: {
    tokenA: bigint;
    tokenB: bigint;
    extension?: bigint;
  }) {
    return this.client.query<PoolState>({
      text: `
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
                WHERE (token0 IN ($1, $2)
                    OR token1 IN ($1, $2))
                  AND extension = $3
            `,
      values: [tokenA, tokenB, extension],
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

  public async getPoolState({
    keyHash,
  }: {
    keyHash: bigint;
  }): Promise<PoolState> {
    const { rows } = await this.client.query<Omit<PoolState, "pool_key_hash">>({
      text: `
                SELECT token0,
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
                WHERE pool_key_hash = $1
            `,
      values: [keyHash],
    });
    if (rows.length !== 1) {
      throw new Error(`Pool with key hash ${keyHash} not found`);
    }

    return {
      pool_key_hash: keyHash.toString(),
      ...rows[0],
    };
  }

  public async getPositionMetadata(
    id: number
  ): Promise<PositionMetadata | null> {
    const { rows, rowCount } = await this.client.query<PositionMetadata>({
      text: `
                SELECT event_keys.transaction_hash AS minted_tx_hash,
                       position_minted.lower_bound,
                       position_minted.upper_bound,
                       pool_keys.token0,
                       pool_keys.token1,
                       pool_keys.fee,
                       pool_keys.tick_spacing,
                       pool_keys.extension,
                       blocks.timestamp            AS minted_timestamp
                FROM position_minted
                         JOIN pool_keys ON position_minted.pool_key_hash = pool_keys.key_hash
                         JOIN event_keys ON position_minted.event_id = event_keys.id
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE token_id = $1
            `,
      values: [id],
    });

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getPositionHistory(id: number) {
    const { rows } = await this.client.query<{
      transaction_hash: string;
      timestamp: number;
      liquidity_delta: string;
      delta0: string;
      delta1: string;
      collect_fees: boolean | null;
      recipient: string | null;
    }>({
      text: `
                WITH all_events AS (SELECT transaction_hash,
                                           timestamp,
                                           liquidity AS liquidity_delta,
                                           delta0,
                                           delta1,
                                           NULL      AS collect_fees,
                                           NULL      AS recipient
                                    FROM position_deposit
                                             JOIN event_keys ON position_deposit.event_id = event_keys.id
                                             JOIN blocks ON event_keys.block_number = blocks.number
                                    WHERE token_id = $1
                                    UNION ALL
                                    SELECT transaction_hash,
                                           timestamp,
                                           -liquidity AS liquidity_delta,
                                           delta0,
                                           delta1,
                                           collect_fees,
                                           recipient
                                    FROM position_withdraw
                                             JOIN event_keys ON position_withdraw.event_id = event_keys.id
                                             JOIN blocks ON event_keys.block_number = blocks.number
                                    WHERE token_id = $1)
                SELECT transaction_hash,
                       timestamp,
                       liquidity_delta,
                       delta0,
                       delta1,
                       collect_fees,
                       recipient
                FROM all_events
                ORDER BY timestamp DESC
            `,
      values: [id],
    });
    return rows;
  }

  public getPairLiquidityGraph({
    token0,
    token1,
  }: {
    token0: bigint;
    token1: bigint;
  }) {
    return this.client.query<{
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
  }

  public getPoolLiquidityGraph(pool_key_hash: bigint) {
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
      values: [pool_key_hash],
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
                                               blocks.timestamp,
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
                                                 blocks.timestamp,
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
                                         WHERE timestamp >= $1),
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
                FROM tvl_delta_by_token_by_hour_by_key_hash_materialized
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
    pair?: { token0: bigint; token1: bigint }
  ) {
    return this.client.query<{ token: string; date: string; balance: string }>({
      text: `
                SELECT token,
                       DATE_TRUNC('day', hour) AS date,
                       SUM(delta)              AS delta
                FROM tvl_delta_by_token_by_hour_by_key_hash_materialized
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

  public async getLastVolumeWeightedPrice({
    baseToken,
    quoteToken,
    since,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    since: Date | null;
  }): Promise<{ price: Decimal; k_volume: bigint } | null> {
    const [token0, token1] =
      baseToken < quoteToken
        ? [baseToken, quoteToken]
        : [quoteToken, baseToken];
    if (baseToken === quoteToken) return null;

    const { rows } = await this.client.query<{
      total: string;
      k_volume: string;
    }>({
      text: `
                SELECT total, k_volume
                FROM pair_vwap_preimages_materialized
                WHERE token0 = $1
                  AND token1 = $2
                  AND (timestamp_start >= $3 OR $3 IS NULL)
                ORDER BY timestamp_start DESC
                LIMIT 1
            `,
      values: [token0, token1, since],
    });

    if (rows.length !== 1) return null;

    const { total, k_volume } = rows[0];

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
                FROM volume_by_token_by_hour_by_key_hash_materialized
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
    }>({
      text: `
                SELECT date_bin($5 * INTERVAL '1 sec', blocks.timestamp,
                                '2000-01-01 00:00:00'::TIMESTAMP WITHOUT TIME ZONE)         AS start,
                       SUM(swaps.delta1 * swaps.delta1) / SUM(ABS(swaps.delta0 * swaps.delta1)) *
                       pow(10, $6)                                                          AS vwap,
                       MIN(CASE
                               WHEN ABS(swaps.delta0) > $7 AND ABS(swaps.delta1) > $8
                                   THEN ABS(swaps.delta1 / swaps.delta0) END) *
                       pow(10, $6)                                                          AS min,
                       MAX(CASE
                               WHEN ABS(swaps.delta0) > $7 AND ABS(swaps.delta1) > $8
                                   THEN ABS(swaps.delta1 / swaps.delta0) END) * pow(10, $6) AS max
                FROM swaps
                         JOIN pool_keys
                              ON swaps.pool_key_hash = pool_keys.key_hash
                         JOIN event_keys ON swaps.event_id = event_keys.id
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE pool_keys.token0 = $1
                  AND pool_keys.token1 = $2
                  AND blocks.timestamp BETWEEN $3 AND $4
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
    pair?: { token0: bigint; token1: bigint }
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
                FROM volume_by_token_by_hour_by_key_hash_materialized
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
  }: {
    start: Date;
    quoteToken: bigint;
  }): Promise<{ token: string; price: Decimal; k_volume: bigint }[]> {
    const { rows } = await this.client.query<{
      token0: string;
      token1: string;
      total: string;
      k_volume: string;
    }>({
      text: `
                SELECT token0, token1, SUM(total) AS total, SUM(k_volume) AS k_volume
                FROM pair_vwap_preimages_materialized
                WHERE (token0 = $1
                    OR token1 = $1)
                  AND timestamp_start >= $2
                GROUP BY token0, token1
            `,
      values: [quoteToken, start],
    });

    return rows.map(({ token0, token1, k_volume, total }) => ({
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
      `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ`
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
    pair?: { token0: bigint; token1: bigint }
  ) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                WITH relevant_pool_keys AS (SELECT key_hash, token0, token1, fee
                                            FROM pool_keys
                                            WHERE COALESCE($1, token0) = token0
                                              AND COALESCE($2, token1) = token1),
                     revenue_deltas AS (SELECT relevant_pool_keys.token0  AS token,
                                               date(blocks.timestamp)     AS date,
                                               -protocol_fees_paid.delta0 AS delta
                                        FROM protocol_fees_paid
                                                 JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                 JOIN blocks
                                                      ON event_keys.block_number = blocks.number
                                        WHERE blocks.timestamp >= $3
                                        UNION ALL
                                        SELECT relevant_pool_keys.token1  AS token,
                                               date(blocks.timestamp)     AS date,
                                               -protocol_fees_paid.delta1 AS delta
                                        FROM protocol_fees_paid
                                                 JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 JOIN event_keys ON protocol_fees_paid.event_id = event_keys.id
                                                 JOIN blocks
                                                      ON event_keys.block_number = blocks.number
                                        WHERE blocks.timestamp >= $3)

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
                                FROM volume_by_token_by_hour_by_key_hash_materialized vbt
                                         INNER JOIN pool_keys ON vbt.key_hash = pool_keys.key_hash
                                WHERE hour >= $1
                                GROUP BY token0, token1),
                     tvl_total AS (SELECT token0,
                                          token1,
                                          SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                   FROM tvl_delta_by_token_by_hour_by_key_hash_materialized tvd
                                            JOIN pool_keys ON pool_keys.key_hash = tvd.key_hash
                                   GROUP BY token0, token1),
                     tvl_delta_24h AS (SELECT token0,
                                              token1,
                                              SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                       FROM tvl_delta_by_token_by_hour_by_key_hash_materialized tvd
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
                                FROM volume_by_token_by_hour_by_key_hash_materialized vbt
                                         JOIN relevant_pool_keys ON vbt.key_hash = relevant_pool_keys.key_hash
                                WHERE hour >= $3
                                GROUP BY vbt.key_hash),
                     tvl_total AS (SELECT tbt.key_hash,
                                          SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                   FROM tvl_delta_by_token_by_hour_by_key_hash_materialized tbt
                                            JOIN pool_keys pk ON tbt.key_hash = pk.key_hash
                                   GROUP BY tbt.key_hash),
                     tvl_delta_24h AS (SELECT tbt.key_hash,
                                              SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                       FROM tvl_delta_by_token_by_hour_by_key_hash_materialized tbt
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
    return this.client.query<PositionMetadata & { token_id: string }>({
      text: `
                WITH ranked_transfers AS (SELECT token_id,
                                                 to_address,
                                                 ROW_NUMBER() OVER (
                                                     PARTITION BY token_id
                                                     ORDER BY event_id DESC
                                                     ) AS row_no
                                          FROM position_transfers
                                          WHERE (from_address = $1
                                              OR to_address = $1)
                                            AND (CASE WHEN $2 THEN to_address != 0 ELSE TRUE END)),
                     final_transfer AS (SELECT token_id,
                                               to_address AS current_owner
                                        FROM ranked_transfers
                                        WHERE row_no = 1)
                SELECT token_id,
                       event_keys.transaction_hash AS minted_tx_hash,
                       token0,
                       token1,
                       fee,
                       tick_spacing,
                       extension,
                       lower_bound,
                       upper_bound,
                       blocks.timestamp            AS minted_timestamp
                FROM position_minted
                         JOIN event_keys ON position_minted.event_id = event_keys.id
                         JOIN pool_keys ON position_minted.pool_key_hash = pool_keys.key_hash
                         JOIN blocks ON event_keys.block_number = blocks.number
                WHERE token_id IN (SELECT token_id FROM final_transfer WHERE current_owner = $1)
                ORDER BY token_id DESC
            `,
      values: [address, showClosed],
    });
  }

  public async getTickData({
    poolKeyHashes,
  }: {
    poolKeyHashes: bigint[];
  }): Promise<{ [key_hash: string]: Tick[] }> {
    const { rows } = await this.client.query<{
      pool_key_hash: string;
      liquidity_delta: string;
      tick: number;
    }>({
      text: `
                SELECT pool_key_hash, tick, net_liquidity_delta_diff AS liquidity_delta
                FROM per_pool_per_tick_liquidity_materialized
                WHERE pool_key_hash = ANY ($1::NUMERIC[])
                ORDER BY pool_key_hash, tick
            `,
      values: [poolKeyHashes],
    });

    return rows.reduce<{ [key_hash: string]: Tick[] }>((memo, value) => {
      if (memo[value.pool_key_hash]) {
        memo[value.pool_key_hash].push({
          tick: value.tick,
          liquidityDelta: BigInt(value.liquidity_delta),
        });
      } else {
        memo[value.pool_key_hash] = [
          { tick: value.tick, liquidityDelta: BigInt(value.liquidity_delta) },
        ];
      }

      return memo;
    }, {});
  }

  public async getAllActiveTokenIdsWithPoolKeys() {
    return this.client.query<{
      token_id: string;
      owner: string;
    }>(`
            WITH tokens_and_owners AS (SELECT token_id,
                                              (SELECT to_address
                                               FROM position_transfers AS pt
                                               WHERE pt.token_id = pm.token_id
                                               ORDER BY pt.event_id DESC
                                               LIMIT 1) AS owner
                                       FROM position_minted AS pm)
            SELECT tao.token_id,
                   tao.owner,
                   pk.token0,
                   pk.token1,
                   pk.fee,
                   pk.tick_spacing,
                   pk.extension,
                   pm.lower_bound,
                   pm.upper_bound
            FROM tokens_and_owners tao
                     JOIN position_minted AS pm ON tao.token_id = pm.token_id
                     JOIN pool_keys AS pk ON pm.pool_key_hash = pk.key_hash
            WHERE tao.owner != 0
        `);
  }

  public async getLeaderboard({
    positionsContractAddress,
    feeTokenAddress,
    collector,
    collectedAfter,
  }: {
    positionsContractAddress: bigint;
    feeTokenAddress: bigint;
    collector?: bigint;
    collectedAfter?: Date;
  }) {
    return this.client.query<{ collector: string; points: number }>({
      name: "leaderboard",
      text: `
                WITH
                    -- the full list of tokens for which there are pools
                    all_tokens AS
                        (SELECT token0 AS token
                         FROM pool_keys
                         UNION
                         DISTINCT
                         SELECT token1 AS token
                         FROM pool_keys),
                    fee_to_discount_factor AS (SELECT DISTINCT (fee)                                                      fee,
                                                               1 - SQRT(fee / 340282366920938463463374607431768211456) AS fee_discount
                                               FROM pool_keys),
                    -- 1 wei of token is converted to points via the last known price, so we get the price here
                    points_conversion AS
                        (SELECT token,
                                (CASE
                                     WHEN token =
                                          $2
                                         THEN 1
                                     ELSE COALESCE((SELECT (CASE
                                                                WHEN token = token0 THEN (total / k_volume)
                                                                ELSE (k_volume / total) END)
                                                    FROM pair_vwap_preimages_materialized
                                                    WHERE (CASE
                                                               WHEN token0 = token THEN token1 = $2
                                                               WHEN token1 = token THEN token0 = $2
                                                               ELSE FALSE END)
                                                      AND k_volume != 0
                                                      AND total != 0
                                                    ORDER BY timestamp_start DESC
                                                    LIMIT 1), 0) END) AS rate
                         FROM all_tokens),

                    position_multipliers AS (SELECT pm.token_id AS token_id,
                                                    2 *
                                                    EXP(GREATEST((pmb.timestamp::DATE - '2023-09-14'::DATE), 0) * -0.01) +
                                                    1           AS multiplier
                                             FROM position_minted AS pm
                                                      JOIN event_keys ON pm.event_id = event_keys.id
                                                      JOIN blocks AS pmb ON event_keys.block_number = pmb.number),

                    points_from_mints AS (SELECT (SELECT to_address
                                                  FROM position_transfers AS pt
                                                  WHERE pt.token_id = pm.token_id
                                                  ORDER BY pt.event_id
                                                  LIMIT 1)                            AS collector,
                                                 pm.referrer                          AS referrer,
                                                 (2000 * multipliers.multiplier)::INT AS points
                                          FROM position_minted AS pm
                                                   JOIN event_keys AS pmek ON pm.event_id = pmek.id
                                              -- this limits to regular deposits of 2 tokens, meaning the position is in range
                                                   JOIN position_deposit AS pd
                                                        ON pm.token_id = pd.token_id
                                                   JOIN event_keys AS pdek ON pd.event_id = pdek.id
                                              AND pmek.block_number = pdek.block_number
                                              AND pmek.transaction_index = pdek.transaction_index
                                              AND pdek.event_index = pmek.event_index + 4
                                              -- this means non-zero deposit of in range
                                              AND pd.delta0 != 0 AND pd.delta1 != 0
                                                   JOIN position_multipliers AS multipliers
                                                        ON pm.token_id = multipliers.token_id
                                                   JOIN blocks AS pmb ON pmek.block_number = pmb.number
                                          WHERE (pmb.timestamp >= $4 OR $4 IS NULL)),

                    position_from_withdrawal_fees_paid AS (SELECT (SELECT to_address
                                                                   FROM position_transfers AS pt
                                                                   WHERE pt.token_id = pfp.salt::BIGINT
                                                                     AND pt.event_id <
                                                                         pfp.event_id
                                                                   ORDER BY pt.event_id DESC
                                                                   LIMIT 1)                 AS collector,
                                                                  pm.referrer               AS referrer,
                                                                  FLOOR(ABS(
                                                                                (pfp.delta0 * pc0.rate * fd.fee_discount) +
                                                                                (pfp.delta1 * pc1.rate * fd.fee_discount)
                                                                        ) * multipliers.multiplier /
                                                                        1e12::NUMERIC)::INT AS points
                                                           FROM protocol_fees_paid AS pfp
                                                                    JOIN position_minted AS pm ON pfp.salt::BIGINT = pm.token_id
                                                                    JOIN position_multipliers AS multipliers
                                                                         ON pm.token_id = multipliers.token_id
                                                                    JOIN pool_keys AS pk ON pfp.pool_key_hash = pk.key_hash
                                                                    JOIN points_conversion AS pc0 ON pc0.token = pk.token0
                                                                    JOIN points_conversion AS pc1 ON pc1.token = pk.token1
                                                                    JOIN fee_to_discount_factor AS fd ON pk.fee = fd.fee),


                    points_from_fees AS (SELECT (SELECT to_address
                                                 FROM position_transfers AS pt
                                                 WHERE pt.token_id = pf.salt::BIGINT
                                                   AND pt.event_id < pf.event_id
                                                 ORDER BY pt.event_id DESC
                                                 LIMIT 1)                                                   AS collector,
                                                pm.referrer                                                 AS referrer,
                                                FLOOR(ABS(SUM(
                                                        (pf.delta0 * pc0.rate * fd.fee_discount) +
                                                        (pf.delta1 * pc1.rate * fd.fee_discount)
                                                          )) * multipliers.multiplier / 1e12::NUMERIC)::INT AS points
                                         FROM position_fees_collected AS pf
                                                  JOIN position_minted AS pm ON pf.salt::BIGINT = pm.token_id
                                                  JOIN position_multipliers AS multipliers
                                                       ON pm.token_id = multipliers.token_id
                                                  JOIN event_keys AS pmek ON pm.event_id = pmek.id
                                                  JOIN blocks AS pmb ON pmek.block_number = pmb.number
                                                  JOIN event_keys AS pfek ON pf.event_id = pfek.id
                                                  JOIN blocks AS pfb ON pfek.block_number = pfb.number
                                                  JOIN pool_keys AS pk ON pf.pool_key_hash = pk.key_hash
                                                  JOIN fee_to_discount_factor AS fd ON pk.fee = fd.fee
                                                  JOIN points_conversion AS pc0 ON pc0.token = pk.token0
                                                  JOIN points_conversion AS pc1 ON pc1.token = pk.token1
                                         WHERE pf.owner = $1
                                           AND (pfb.timestamp >= $4 OR $4 IS NULL)
                                         GROUP BY pmb.timestamp, multipliers.multiplier, collector, referrer),
                    points_by_collector_with_referrals AS (SELECT collector, points
                                                           FROM points_from_fees
                                                           UNION ALL
                                                           SELECT referrer AS collector, (points / 5) AS points
                                                           FROM points_from_fees
                                                           WHERE referrer IS NOT NULL
                                                           UNION ALL
                                                           SELECT collector, points
                                                           FROM points_from_mints
                                                           UNION ALL
                                                           SELECT referrer AS collector, (points / 5)
                                                           FROM points_from_mints
                                                           UNION ALL
                                                           SELECT collector, points
                                                           FROM position_from_withdrawal_fees_paid
                                                           UNION ALL
                                                           SELECT referrer AS collector, (points / 5)
                                                           FROM position_from_withdrawal_fees_paid)
                SELECT collector,
                       SUM(points) AS points
                FROM points_by_collector_with_referrals
                WHERE collector NOT IN (1791658794084622206857007003215132198038653612739770816311687551920625505808)
                  AND collector = COALESCE($3, collector)
                GROUP BY collector
                ORDER BY points DESC
                LIMIT 1000
            `,
      values: [
        positionsContractAddress,
        feeTokenAddress,
        collector ?? null,
        collectedAfter ?? null,
      ],
    });
  }
}
