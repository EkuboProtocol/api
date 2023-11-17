import { Client } from "pg";
import Decimal from "decimal.js-light";
import { Tick } from "./nodes/plainPool";

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
  block_number: string;
  transaction_index: number;
  event_index: number;
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
                   block_number,
                   transaction_index,
                   event_index
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
                       block_number,
                       transaction_index,
                       event_index
                FROM pool_states_materialized
                         JOIN pool_keys ON pool_key_hash = key_hash
                WHERE (token0 IN ($1, $2)
                    OR token1 IN ($1, $2))
                  AND extension = $3
            `,
      values: [tokenA, tokenB, extension],
    });
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
                 block_number,
                 transaction_index,
                 event_index
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
                SELECT position_minted.transaction_hash AS minted_tx_hash,
                       position_minted.lower_bound,
                       position_minted.upper_bound,
                       pool_keys.token0,
                       pool_keys.token1,
                       pool_keys.fee,
                       pool_keys.tick_spacing,
                       pool_keys.extension,
                       blocks.timestamp                 AS minted_timestamp
                FROM position_minted
                         JOIN pool_keys ON position_minted.pool_key_hash = pool_keys.key_hash
                         JOIN blocks ON position_minted.block_number = blocks.number
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
                                             JOIN blocks ON position_deposit.block_number = blocks.number
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
                                             JOIN blocks ON position_withdraw.block_number = blocks.number
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
                FROM per_pool_per_tick_liquidity
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
                FROM per_pool_per_tick_liquidity
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
                                                 JOIN blocks ON swaps.block_number = blocks.number),
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
                                                   JOIN blocks ON position_updates.block_number = blocks.number),
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

  public getRevenueByToken(
    since: Date,
    pair?: { token0: bigint; token1: bigint }
  ) {
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
                                                  INNER JOIN relevant_blocks
                                                             ON protocol_fees_paid.block_number = relevant_blocks.number
                                                  INNER JOIN
                                              relevant_pool_keys
                                              ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                         UNION ALL
                                         SELECT relevant_pool_keys.token1  AS token,
                                                -protocol_fees_paid.delta1 AS delta
                                         FROM protocol_fees_paid
                                                  INNER JOIN relevant_blocks
                                                             ON protocol_fees_paid.block_number = relevant_blocks.number
                                                  INNER JOIN
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
                FROM tvl_delta_by_token_by_hour_by_key_hash
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
                FROM tvl_delta_by_token_by_hour_by_key_hash
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
    newerThan,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    newerThan: Date;
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
            AND timestamp_start >= $3
          ORDER BY timestamp_start DESC
          LIMIT 1
      `,
      values: [token0, token1, newerThan],
    });

    if (rows.length !== 1) return null;

    const { total, k_volume } = rows[0];

    const price =
      baseToken < quoteToken
        ? new Decimal(total).div(k_volume)
        : new Decimal(k_volume).div(total);
    return { price, k_volume: BigInt(k_volume) };
  }

  public getTotalVolumeByToken(
    since: Date,
    pair?: { token0: bigint; token1: bigint }
  ) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
                SELECT token,
                       SUM(volume) AS volume,
                       SUM(fees)   AS fees
                FROM volume_by_token_by_hour_by_key_hash
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
                FROM volume_by_token_by_hour_by_key_hash
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
                                                 INNER JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 INNER JOIN blocks
                                                            ON protocol_fees_paid.block_number = blocks.number
                                        WHERE blocks.timestamp >= $3
                                        UNION ALL
                                        SELECT relevant_pool_keys.token1  AS token,
                                               date(blocks.timestamp)     AS date,
                                               -protocol_fees_paid.delta1 AS delta
                                        FROM protocol_fees_paid
                                                 INNER JOIN
                                             relevant_pool_keys
                                             ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                                 INNER JOIN blocks ON blocks.number = protocol_fees_paid.block_number
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
                                FROM volume_by_token_by_hour_by_key_hash vbt
                                         INNER JOIN pool_keys ON vbt.key_hash = pool_keys.key_hash
                                WHERE hour >= $1
                                GROUP BY token0, token1),
                     tvl_total AS (SELECT token0,
                                          token1,
                                          SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                   FROM tvl_delta_by_token_by_hour_by_key_hash tvd
                                            JOIN pool_keys ON pool_keys.key_hash = tvd.key_hash
                                   GROUP BY token0, token1),
                     tvl_delta_24h AS (SELECT token0,
                                              token1,
                                              SUM(CASE WHEN token0 = token THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token1 = token THEN delta ELSE 0 END) AS tvl1
                                       FROM tvl_delta_by_token_by_hour_by_key_hash tvd
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
                                FROM volume_by_token_by_hour_by_key_hash vbt
                                         JOIN relevant_pool_keys ON vbt.key_hash = relevant_pool_keys.key_hash
                                WHERE hour >= $3
                                GROUP BY vbt.key_hash),
                     tvl_total AS (SELECT tbt.key_hash,
                                          SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                          SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                   FROM tvl_delta_by_token_by_hour_by_key_hash tbt
                                            JOIN pool_keys pk ON tbt.key_hash = pk.key_hash
                                   GROUP BY tbt.key_hash),
                     tvl_delta_24h AS (SELECT tbt.key_hash,
                                              SUM(CASE WHEN token = token0 THEN delta ELSE 0 END) AS tvl0,
                                              SUM(CASE WHEN token = token1 THEN delta ELSE 0 END) AS tvl1
                                       FROM tvl_delta_by_token_by_hour_by_key_hash tbt
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
                                                     ORDER BY block_number DESC, transaction_index DESC, event_index DESC
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
                       position_minted.transaction_hash AS minted_tx_hash,
                       token0,
                       token1,
                       fee,
                       tick_spacing,
                       extension,
                       lower_bound,
                       upper_bound,
                       blocks.timestamp                 AS minted_timestamp
                FROM position_minted
                         JOIN pool_keys ON position_minted.pool_key_hash = pool_keys.key_hash
                         JOIN blocks ON position_minted.block_number = blocks.number
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
          FROM per_pool_per_tick_liquidity
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

  public async getLeaderboard({
    positionsContractAddress,
    feeTokenAddress,
  }: {
    positionsContractAddress: bigint;
    feeTokenAddress: bigint;
  }) {
    return this.client.query<{ collector: string; points: string }>({
      name: "leaderboard",
      text: `
          WITH token_owners AS (SELECT pm.token_id,
                                       (SELECT to_address
                                        FROM position_transfers AS pt
                                        WHERE pm.token_id = pt.token_id
                                          AND pt.to_address != 0
                                        ORDER BY pt.block_number DESC, pt.transaction_index DESC, pt.event_index DESC
                                        LIMIT 1) AS last_owner
                                FROM position_minted AS pm),
               fees_collected_by_pair AS (SELECT token_owners.last_owner AS collector,
                                                 token0,
                                                 token1,
                                                 SUM(delta0)             AS total_token0,
                                                 SUM(delta1)             AS total_token1
                                          FROM position_fees_collected
                                                   JOIN token_owners ON token_owners.token_id = position_fees_collected.salt
                                                   JOIN pool_keys ON position_fees_collected.pool_key_hash = pool_keys.key_hash
                                          WHERE position_fees_collected.owner = $1
                                            AND pool_keys.fee <= 17014118346046923173168730371588410572 -- 5%
                                          GROUP BY token_owners.last_owner, token0, token1),
               fees_collected_by_token AS (SELECT collector,
                                                  token0       AS token,
                                                  total_token0 AS amount
                                           FROM fees_collected_by_pair
                                           WHERE total_token0 != 0
                                           UNION ALL
                                           SELECT collector,
                                                  token1       AS token,
                                                  total_token1 AS amount
                                           FROM fees_collected_by_pair
                                           WHERE total_token1 != 0),
               total_fees_by_collector_by_token AS (SELECT collector, token, ABS(SUM(amount)) AS fees_collected
                                                    FROM fees_collected_by_token
                                                    GROUP BY collector, token),
               -- todo: better conversion for fees by token into points (e.g. use ether price)
               all_tokens AS (SELECT token0 AS token
                              FROM pool_keys
                              UNION
                              DISTINCT
                              SELECT token1 AS token
                              FROM pool_keys),
               points_conversion AS (SELECT token,
                                            COALESCE((SELECT (CASE
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
                                                      LIMIT 1), 0) AS points_conversion
                                     FROM all_tokens)
          SELECT collector, SUM(total_fees_by_collector_by_token.fees_collected * points_conversion) AS points
          FROM total_fees_by_collector_by_token
                   JOIN points_conversion
                        ON total_fees_by_collector_by_token.token = points_conversion.token
          GROUP BY collector
          ORDER BY points DESC
          LIMIT 1000
      `,
      values: [positionsContractAddress, feeTokenAddress],
    });
  }
}
