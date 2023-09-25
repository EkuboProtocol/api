import { Client } from "pg";
import Decimal from "decimal.js-light";

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

const U128_DENOMINATOR = 2n ** 128n;

export class Queries {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async getPositionMetadata(
    id: number
  ): Promise<PositionMetadata | null> {
    const { rows, rowCount } = await this.client.query<PositionMetadata>({
      text: `
        SELECT position_minted.transaction_hash as minted_tx_hash,
               position_minted.lower_bound,
               position_minted.upper_bound,
               pool_keys.token0,
               pool_keys.token1,
               pool_keys.fee,
               pool_keys.tick_spacing,
               pool_keys.extension,
               blocks.timestamp                 AS minted_timestamp
        FROM position_minted
                 JOIN pool_keys on position_minted.pool_key_hash = pool_keys.key_hash
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
                                     liquidity as liquidity_delta,
                                     delta0,
                                     delta1,
                                     NULL      as collect_fees,
                                     NULL      as recipient
                              FROM position_deposit
                                       JOIN blocks ON position_deposit.block_number = blocks.number
                              WHERE token_id = $1
                              UNION ALL
                              SELECT transaction_hash,
                                     timestamp,
                                     -liquidity as liquidity_delta,
                                     delta0,
                                     delta1,
                                     collect_fees,
                                     recipient
                              from position_withdraw
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
          WITH pool_key_hashes AS (SELECT key_hash
                                   FROM pool_keys
                                   WHERE (token0 = $1 AND token1 = $2)),
               lower AS (SELECT lower_bound as       tick,
                                SUM(liquidity_delta) net_liquidity_delta
                         FROM position_updates
                         WHERE pool_key_hash in (SELECT key_hash FROM pool_key_hashes)
                         GROUP BY lower_bound, pool_key_hash),

               upper AS (SELECT upper_bound as       tick,
                                SUM(liquidity_delta) net_liquidity_delta
                         FROM position_updates
                         WHERE pool_key_hash in (SELECT key_hash FROM pool_key_hashes)
                         GROUP BY upper_bound, pool_key_hash)

          SELECT COALESCE(lower.tick, upper.tick)       AS tick,
                 COALESCE(lower.net_liquidity_delta, 0) -
                 COALESCE(upper.net_liquidity_delta, 0) as net_liquidity_delta_diff
          FROM lower
                   FULL JOIN upper ON lower.tick = upper.tick
          WHERE COALESCE(lower.net_liquidity_delta, 0) - COALESCE(upper.net_liquidity_delta, 0) != 0
          ORDER BY tick ASC;
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
                WITH lower AS (SELECT lower_bound as       tick,
                                      SUM(liquidity_delta) net_liquidity_delta
                               FROM position_updates
                               WHERE pool_key_hash = $1
                               GROUP BY lower_bound, pool_key_hash),

                     upper AS (SELECT upper_bound as       tick,
                                      SUM(liquidity_delta) net_liquidity_delta
                               FROM position_updates
                               WHERE pool_key_hash = $1
                               GROUP BY upper_bound, pool_key_hash)

                SELECT COALESCE(lower.tick, upper.tick)       AS tick,
                       COALESCE(lower.net_liquidity_delta, 0) -
                       COALESCE(upper.net_liquidity_delta, 0) as net_liquidity_delta_diff
                FROM lower
                         FULL JOIN upper ON lower.tick = upper.tick
                WHERE COALESCE(lower.net_liquidity_delta, 0) - COALESCE(upper.net_liquidity_delta, 0) != 0
                ORDER BY tick ASC;
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
               relevant_swaps AS (SELECT 0 as type,
                                         relevant_pool_keys.key_hash as pool_key_hash,
                                         relevant_pool_keys.fee,
                                         relevant_pool_keys.tick_spacing,
                                         relevant_pool_keys.extension,
                                         blocks.timestamp,
                                         transaction_hash,
                                         block_number,
                                         transaction_index,
                                         event_index,
                                         delta0,
                                         delta1
                                  FROM swaps
                                           JOIN relevant_pool_keys ON key_hash = pool_key_hash
                                           JOIN blocks ON swaps.block_number = blocks.number),
               relevant_updates AS (SELECT 1 as type,
                                           relevant_pool_keys.key_hash as pool_key_hash,
                                           relevant_pool_keys.fee,
                                           relevant_pool_keys.tick_spacing,
                                           relevant_pool_keys.extension,
                                           blocks.timestamp,
                                           transaction_hash,
                                           block_number,
                                           transaction_index,
                                           event_index,
                                           delta0,
                                           delta1
                                    FROM position_updates
                                             JOIN relevant_pool_keys
                                                  ON key_hash = pool_key_hash
                                             JOIN blocks ON position_updates.block_number = blocks.number),
               combined AS (SELECT *
                            from relevant_updates
                            UNION ALL
                            SELECT *
                            from relevant_swaps)

          SELECT *
          FROM combined
          ORDER BY block_number DESC, transaction_index DESC, event_index DESC
          LIMIT $3
      `,
      values: [token0, token1, limit],
    });
  }

  public getTotalVolume(
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
               token_deltas AS (SELECT relevant_pool_keys.token0                               as token,
                                       CASE WHEN swaps.delta0 > 0 THEN swaps.delta0 ELSE 0 END as delta,
                                       CASE
                                           WHEN swaps.delta0 > 0 THEN FLOOR(swaps.delta0 * relevant_pool_keys.fee /
                                                                            ${U128_DENOMINATOR})
                                           ELSE 0 END                                          AS fees
                                FROM swaps
                                         INNER JOIN relevant_blocks ON block_number = relevant_blocks.number
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash
                                UNION ALL
                                SELECT relevant_pool_keys.token1                               as token,
                                       CASE WHEN swaps.delta1 > 0 THEN swaps.delta1 ELSE 0 END as delta,
                                       CASE
                                           WHEN swaps.delta1 > 0 THEN FLOOR(swaps.delta1 * relevant_pool_keys.fee /
                                                                            ${U128_DENOMINATOR})
                                           ELSE 0 END                                          AS fees
                                FROM swaps
                                         INNER JOIN relevant_blocks ON block_number = relevant_blocks.number
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash)
          SELECT token,
                 SUM(delta) as volume,
                 SUM(fees)  as fees
          FROM token_deltas
          GROUP BY token_deltas.token
      `,
      values: [since, pair?.token0 ?? null, pair?.token1 ?? null],
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
               token_fees_paid AS (SELECT relevant_pool_keys.token0  as token,
                                          -protocol_fees_paid.delta0 as delta
                                   FROM protocol_fees_paid
                                            INNER JOIN relevant_blocks
                                                       ON protocol_fees_paid.block_number = relevant_blocks.number
                                            INNER JOIN
                                        relevant_pool_keys
                                        ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                   UNION ALL
                                   SELECT relevant_pool_keys.token1  as token,
                                          -protocol_fees_paid.delta1 as delta
                                   FROM protocol_fees_paid
                                            INNER JOIN relevant_blocks
                                                       ON protocol_fees_paid.block_number = relevant_blocks.number
                                            INNER JOIN
                                        relevant_pool_keys
                                        ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash)
          SELECT token,
                 SUM(delta) as revenue
          FROM token_fees_paid
          GROUP BY token_fees_paid.token
      `,
      values: [since, pair?.token0 ?? null, pair?.token1 ?? null],
    });
  }

  public getTvlByToken(pair?: { token0: bigint; token1: bigint }) {
    return this.client.query<{ token: string; balance: string }>({
      text: `
          WITH relevant_pool_keys AS (SELECT key_hash, token0, token1
                                      FROM pool_keys
                                      WHERE COALESCE($1, token0) = token0
                                        AND COALESCE($2, token1) = token1),
               token_deltas AS (SELECT relevant_pool_keys.token0 as token,
                                       position_updates.delta0   as delta
                                FROM position_updates
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = position_updates.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token1 as token,
                                       position_updates.delta1   as delta
                                FROM position_updates
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = position_updates.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token0 as token,
                                       swaps.delta0              as delta
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token1 as token,
                                       swaps.delta1              as delta
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token0      as token,
                                       position_fees_collected.delta0 as delta
                                FROM position_fees_collected
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = position_fees_collected.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token1      as token,
                                       position_fees_collected.delta1 as delta
                                FROM position_fees_collected
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = position_fees_collected.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token0 as token,
                                       protocol_fees_paid.delta0 as delta
                                FROM protocol_fees_paid
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash

                                UNION ALL

                                SELECT relevant_pool_keys.token1 as token,
                                       protocol_fees_paid.delta1 as delta
                                FROM protocol_fees_paid
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash)
          SELECT token,
                 SUM(delta) as balance
          FROM token_deltas
          GROUP BY token_deltas.token;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null],
    });
  }

  public getTvlDeltaByTokenByDate(
    after: Date,
    pair?: { token0: bigint; token1: bigint }
  ) {
    return this.client.query<{ token: string; balance: string }>({
      text: `
          WITH relevant_pool_keys AS (SELECT key_hash, token0, token1
                                      FROM pool_keys
                                      WHERE COALESCE($1, token0) = token0 AND COALESCE($2, token1) = token1),
               token_deltas AS (SELECT relevant_pool_keys.token0 as token,
                                       position_updates.delta0   as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM position_updates
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = position_updates.pool_key_hash
                                         INNER JOIN blocks
                                                    ON position_updates.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token1 as token,
                                       position_updates.delta1   as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM position_updates
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = position_updates.pool_key_hash
                                         INNER JOIN blocks
                                                    ON position_updates.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token0 as token,
                                       swaps.delta0              as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks
                                                    ON swaps.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token1 as token,
                                       swaps.delta1              as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks
                                                    ON swaps.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token0      as token,
                                       position_fees_collected.delta0 as delta,
                                       DATE(blocks.timestamp)         as date
                                FROM position_fees_collected
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = position_fees_collected.pool_key_hash
                                         INNER JOIN blocks
                                                    ON position_fees_collected.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token1      as token,
                                       position_fees_collected.delta1 as delta,
                                       DATE(blocks.timestamp)         as date
                                FROM position_fees_collected
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = position_fees_collected.pool_key_hash
                                         INNER JOIN blocks
                                                    ON position_fees_collected.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token0 as token,
                                       protocol_fees_paid.delta0 as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM protocol_fees_paid
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                         INNER JOIN blocks
                                                    ON protocol_fees_paid.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token1 as token,
                                       protocol_fees_paid.delta1 as delta,
                                       DATE(blocks.timestamp)    as date
                                FROM protocol_fees_paid
                                         INNER JOIN
                                     relevant_pool_keys
                                     ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                         INNER JOIN blocks
                                                    ON protocol_fees_paid.block_number = blocks.number
                                WHERE blocks.timestamp >= $3)

          SELECT token,
                 date,
                 SUM(delta) as delta
          FROM token_deltas
          GROUP BY token, date
          ORDER BY token, date;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async getVolumeWeightedPrice({
    baseToken,
    quoteToken,
    since,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    since: Date;
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
          SELECT SUM(ABS(delta1 * delta1)) AS total, SUM(ABS(delta0 * delta1)) AS k_volume 
          FROM swaps
                   JOIN blocks ON swaps.block_number = blocks.number
                   JOIN pool_keys ON swaps.pool_key_hash = pool_keys.key_hash
          WHERE token0 = $1
            AND token1 = $2
            AND blocks.timestamp > $3
          GROUP BY token0, token1
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

  public async getAllVolumeWeightedPrices({
    start,
    end,
    quoteToken,
  }: {
    start: Date;
    end: Date;
    quoteToken: bigint;
  }): Promise<{ token: string; price: Decimal; k_volume: bigint }[]> {
    const { rows } = await this.client.query<{
      token0: string;
      token1: string;
      total: string;
      k_volume: string;
    }>({
      text: `
          SELECT token0, token1, SUM(ABS(delta1 * delta1)) AS total, SUM(ABS(delta0 * delta1)) AS k_volume
          FROM swaps
                   JOIN blocks ON swaps.block_number = blocks.number
                   JOIN pool_keys ON swaps.pool_key_hash = pool_keys.key_hash
          WHERE (token0 = $1
              OR token1 = $1)
            AND blocks.timestamp > $2
            AND blocks.timestamp < $3
          GROUP BY token0, token1
      `,
      values: [quoteToken, start, end],
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

  public async getVolumeByTokenByDate(
    after: Date,
    pair?: { token0: bigint; token1: bigint }
  ) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
          WITH relevant_pool_keys AS (SELECT key_hash, token0, token1, fee
                                      FROM pool_keys
                                      WHERE COALESCE($1, token0) = token0
                                        AND COALESCE($2, token1) = token1),
               token_deltas AS (SELECT relevant_pool_keys.token0 as token,
                                       DATE(blocks.timestamp)    as date,
                                       CASE WHEN swaps.delta0 > 0 THEN swaps.delta0 ELSE 0 END         as delta,
                                       CASE
                                           WHEN swaps.delta0 > 0 THEN FLOOR(swaps.delta0 * relevant_pool_keys.fee /
                                                                            ${U128_DENOMINATOR})
                                           ELSE 0 END            AS fees
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks
                                                    ON swaps.block_number = blocks.number
                                WHERE blocks.timestamp >= $3
                                UNION ALL
                                SELECT relevant_pool_keys.token1 as token,
                                       DATE(blocks.timestamp)    as date,
                                       CASE WHEN swaps.delta1 > 0 THEN swaps.delta1 ELSE 0 END         as delta,
                                       CASE
                                           WHEN swaps.delta0 > 0 THEN FLOOR(swaps.delta0 * relevant_pool_keys.fee /
                                                                            ${U128_DENOMINATOR})
                                           ELSE 0 END            AS fees
                                FROM swaps
                                         INNER JOIN
                                     relevant_pool_keys ON relevant_pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks on blocks.number = swaps.block_number
                                WHERE blocks.timestamp >= $3)

          SELECT token,
                 date,
                 SUM(delta) as volume,
                 SUM(fees)  as fees
          FROM token_deltas
          GROUP BY token, date
          ORDER BY token, date;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async withinTransaction<T>(doX: () => Promise<T>): Promise<T> {
    await this.client.query(`BEGIN`);
    const result = await doX();
    await this.client.query("COMMIT");
    return result;
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
               revenue_deltas AS (SELECT relevant_pool_keys.token0  as token,
                                         DATE(blocks.timestamp)     as date,
                                         -protocol_fees_paid.delta0 as delta
                                  FROM protocol_fees_paid
                                           INNER JOIN
                                       relevant_pool_keys
                                       ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                           INNER JOIN blocks
                                                      ON protocol_fees_paid.block_number = blocks.number
                                  WHERE blocks.timestamp >= $3
                                  UNION ALL
                                  SELECT relevant_pool_keys.token1  as token,
                                         DATE(blocks.timestamp)     as date,
                                         -protocol_fees_paid.delta1 as delta
                                  FROM protocol_fees_paid
                                           INNER JOIN
                                       relevant_pool_keys
                                       ON relevant_pool_keys.key_hash = protocol_fees_paid.pool_key_hash
                                           INNER JOIN blocks on blocks.number = protocol_fees_paid.block_number
                                  WHERE blocks.timestamp >= $3)

          SELECT token,
                 date,
                 SUM(delta) as revenue
          FROM revenue_deltas
          GROUP BY token, date
          ORDER BY token, date;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after],
    });
  }

  public async getTopPairs() {
    return this.client.query<{ token: string; volume: string }>({
      text: `
        WITH relevant_blocks AS (SELECT number
                                 FROM blocks
                                 WHERE timestamp >= $1),
             volume AS (SELECT token0,
                               token1,
                               SUM(CASE WHEN swaps.delta0 > 0 THEN swaps.delta0 ELSE 0 END) as volume0,
                               SUM(CASE WHEN swaps.delta1 > 0 THEN swaps.delta1 ELSE 0 END) as volume1,
                               SUM(
                                   CASE
                                     WHEN swaps.delta0 > 0 THEN FLOOR(swaps.delta0 * pool_keys.fee /
                                                                      ${U128_DENOMINATOR})
                                     ELSE 0 END
                                 )                    AS fees0,
                               SUM(
                                   CASE
                                     WHEN swaps.delta1 > 0 THEN FLOOR(swaps.delta1 * pool_keys.fee /
                                                                      ${U128_DENOMINATOR})
                                     ELSE 0 END
                                 )                    AS fees1
                        FROM swaps
                               INNER JOIN pool_keys ON swaps.pool_key_hash = pool_keys.key_hash
                               INNER JOIN relevant_blocks
                                          ON swaps.block_number = relevant_blocks.number
                        GROUP BY token0, token1),
             tvl_changes AS (SELECT block_number,
                                    token0,
                                    token1,
                                    delta0,
                                    delta1
                             FROM swaps
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    token0,
                                    token1,
                                    delta0,
                                    delta1
                             FROM position_updates
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    token0,
                                    token1,
                                    delta0,
                                    delta1
                             FROM position_fees_collected
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    token0,
                                    token1,
                                    delta0,
                                    delta1
                             FROM protocol_fees_paid
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash),
             tvl_total AS (SELECT token0,
                                  token1,
                                  SUM(delta0) as tvl0,
                                  SUM(delta1) as tvl1
                           FROM tvl_changes
                           GROUP BY token0, token1),
             tvl_delta_24h AS (SELECT token0,
                                      token1,
                                      SUM(delta0) as tvl0,
                                      SUM(delta1) as tvl1
                               FROM tvl_changes
                                      JOIN relevant_blocks
                                           ON tvl_changes.block_number = relevant_blocks.number
                               GROUP BY token0, token1)
        SELECT COALESCE(volume.token0, tvl_total.token0) as token0,
               COALESCE(volume.token1, tvl_total.token1) as token1,
               COALESCE(volume.volume0, 0)               as volume0_24h,
               COALESCE(volume.volume1, 0)               as volume1_24h,
               COALESCE(volume.fees0, 0)                 as fees0_24h,
               COALESCE(volume.fees1, 0)                 as fees1_24h,
               COALESCE(tvl_total.tvl0, 0)               as tvl0_total,
               COALESCE(tvl_total.tvl1, 0)               as tvl1_total,
               COALESCE(tvl_delta_24h.tvl0, 0)           as tvl0_delta_24h,
               COALESCE(tvl_delta_24h.tvl1, 0)           as tvl1_delta_24h
        FROM volume
               FULL OUTER JOIN
             tvl_total ON volume.token0 = tvl_total.token0 AND volume.token1 = tvl_total.token1
               FULL OUTER JOIN tvl_delta_24h
                               ON tvl_delta_24h.token0 = COALESCE(volume.token0, tvl_total.token0) AND
                                  tvl_delta_24h.token1 = COALESCE(volume.token1, tvl_total.token1);
      `,
      values: [new Date(Date.now() - 86_400_000)],
    });
  }

  public async getTopPools(pair: { token0: bigint; token1: bigint }) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
        WITH relevant_pool_keys AS (SELECT key_hash, token0, token1, fee, tick_spacing, extension
                                    FROM pool_keys
                                    WHERE token0 = $1
                                      AND token1 = $2),
             relevant_blocks AS (SELECT number
                                 FROM blocks
                                 WHERE timestamp >= $3),
             volume AS (SELECT key_hash,
                               SUM(CASE WHEN swaps.delta0 > 0 THEN swaps.delta0 ELSE 0 END) as volume0,
                               SUM(CASE WHEN swaps.delta1 > 0 THEN swaps.delta1 ELSE 0 END) as volume1,
                               SUM(
                                   CASE
                                     WHEN swaps.delta0 > 0 THEN FLOOR(swaps.delta0 * relevant_pool_keys.fee /
                                                                      ${U128_DENOMINATOR})
                                     ELSE 0 END
                                 )                    AS fees0,
                               SUM(
                                   CASE
                                     WHEN swaps.delta1 > 0 THEN FLOOR(swaps.delta1 * relevant_pool_keys.fee /
                                                                      ${U128_DENOMINATOR})
                                     ELSE 0 END
                                 )                    AS fees1
                        FROM swaps
                               INNER JOIN relevant_pool_keys ON swaps.pool_key_hash = relevant_pool_keys.key_hash
                               INNER JOIN relevant_blocks
                                          ON swaps.block_number = relevant_blocks.number
                        GROUP BY key_hash),
             tvl_changes AS (SELECT block_number,
                                    key_hash,
                                    delta0,
                                    delta1
                             FROM swaps
                                    JOIN relevant_pool_keys ON pool_key_hash = relevant_pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    key_hash,
                                    delta0,
                                    delta1
                             FROM position_updates
                                    JOIN relevant_pool_keys ON pool_key_hash = relevant_pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    key_hash,
                                    delta0,
                                    delta1
                             FROM position_fees_collected
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash

                             UNION ALL

                             SELECT block_number,
                                    key_hash,
                                    delta0,
                                    delta1
                             FROM protocol_fees_paid
                                    JOIN pool_keys ON pool_key_hash = pool_keys.key_hash),
             tvl_total AS (SELECT key_hash,
                                  SUM(delta0) as tvl0,
                                  SUM(delta1) as tvl1
                           FROM tvl_changes
                           GROUP BY key_hash),
             tvl_delta_24h AS (SELECT key_hash,
                                      SUM(delta0) as tvl0,
                                      SUM(delta1) as tvl1
                               FROM tvl_changes
                                      JOIN relevant_blocks
                                           ON tvl_changes.block_number = relevant_blocks.number
                               GROUP BY key_hash)
        SELECT relevant_pool_keys.fee,
               relevant_pool_keys.tick_spacing,
               relevant_pool_keys.extension,
               COALESCE(volume.volume0, 0)     as volume0_24h,
               COALESCE(volume.volume1, 0)     as volume1_24h,
               COALESCE(volume.fees0, 0)       as fees0_24h,
               COALESCE(volume.fees1, 0)       as fees1_24h,
               COALESCE(tvl_total.tvl0, 0)     as tvl0_total,
               COALESCE(tvl_total.tvl1, 0)     as tvl1_total,
               COALESCE(tvl_delta_24h.tvl0, 0) as tvl0_delta_24h,
               COALESCE(tvl_delta_24h.tvl1, 0) as tvl1_delta_24h
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

  public async getPositionsByAddress(address: bigint) {
    return this.client.query<PositionMetadata & { token_id: string }>({
      text: `
          WITH ranked_transfers AS (SELECT token_id,
                                           to_address,
                                           ROW_NUMBER() OVER (
                                               PARTITION BY token_id
                                               ORDER BY block_number DESC, transaction_index DESC
                                               ) AS row_no
                                    FROM position_transfers
                                    WHERE from_address = $1
                                       OR to_address = $1),
               final_transfer AS (SELECT token_id,
                                         to_address AS current_owner
                                  FROM ranked_transfers
                                  WHERE row_no = 1)
          SELECT token_id,
                 position_minted.transaction_hash as minted_tx_hash,
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
      values: [address],
    });
  }
}
