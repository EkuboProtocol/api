import { Client } from "pg";

export class Queries {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async getTokenMetadata(id: number) {
    const { rows, rowCount } = await this.client.query<{
      lower_bound: string;
      upper_bound: string;
      token0: string;
      token1: string;
      fee: string;
      tick_spacing: string;
      extension: string;
    }>(`
            SELECT position_minted.lower_bound,
                   position_minted.upper_bound,
                   pool_keys.token0,
                   pool_keys.token1,
                   pool_keys.fee,
                   pool_keys.tick_spacing,
                   pool_keys.extension
            FROM position_minted
                     JOIN pool_keys on position_minted.pool_key_hash = pool_keys.key_hash
            WHERE token_id = ${id}
        `);

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
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
      name: `get-liquidity-graph-pair`,
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
      name: `get-liquidity-graph`,
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

  public getVolumeByToken() {
    return this.client.query<{ token: string; volume: string }>({
      name: `get-volume-by-token`,
      text: `
                WITH token_deltas AS (SELECT pool_keys.token0  as token,
                                             ABS(swaps.delta0) as delta
                                      FROM swaps
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                      UNION ALL
                                      SELECT pool_keys.token1  as token,
                                             ABS(swaps.delta1) as delta
                                      FROM swaps
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = swaps.pool_key_hash)
                SELECT token,
                       SUM(delta) as volume
                FROM token_deltas
                GROUP BY token_deltas.token
            `,
    });
  }

  public getTvlByToken() {
    return this.client.query<{ token: string; balance: string }>({
      name: `get-tvl-by-token`,
      text: `
                WITH token_deltas AS (SELECT pool_keys.token0        as token,
                                             position_updates.delta0 as delta
                                      FROM position_updates
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = position_updates.pool_key_hash
                                      UNION ALL
                                      SELECT pool_keys.token1        as token,
                                             position_updates.delta1 as delta
                                      FROM position_updates
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = position_updates.pool_key_hash

                                      UNION ALL
                                      SELECT pool_keys.token0 as token,
                                             swaps.delta0     as delta
                                      FROM swaps
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                      UNION ALL
                                      SELECT pool_keys.token1 as token,
                                             swaps.delta1     as delta
                                      FROM swaps
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = swaps.pool_key_hash)
                SELECT token,
                       SUM(delta) as balance
                FROM token_deltas
                GROUP BY token_deltas.token;
            `,
    });
  }

  public getTvlDeltaByTokenByDate(after: Date) {
    return this.client.query<{ token: string; balance: string }>({
      name: `get-tvl-by-token-by-day`,
      text: `
        WITH token_deltas AS (SELECT pool_keys.token0        as token,
                                     position_updates.delta0 as delta,
                                     DATE(blocks.timestamp)  as date
                              FROM position_updates
                                     INNER JOIN
                                   pool_keys ON pool_keys.key_hash = position_updates.pool_key_hash
                                     INNER JOIN blocks
                                                ON position_updates.block_number = blocks.number
                              WHERE blocks.timestamp >= $1
                              UNION ALL
                              SELECT pool_keys.token1        as token,
                                     position_updates.delta1 as delta,
                                     DATE(blocks.timestamp)  as date
                              FROM position_updates
                                     INNER JOIN
                                   pool_keys ON pool_keys.key_hash = position_updates.pool_key_hash
                                     INNER JOIN blocks
                                                ON position_updates.block_number = blocks.number
                              WHERE blocks.timestamp >= $1
                              UNION ALL
                              SELECT pool_keys.token0       as token,
                                     swaps.delta0           as delta,
                                     DATE(blocks.timestamp) as date
                              FROM swaps
                                     INNER JOIN
                                   pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                     INNER JOIN blocks
                                                ON swaps.block_number = blocks.number
                              WHERE blocks.timestamp >= $1
                              UNION ALL
                              SELECT pool_keys.token1       as token,
                                     swaps.delta1           as delta,
                                     DATE(blocks.timestamp) as date
                              FROM swaps
                                     INNER JOIN
                                   pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                     INNER JOIN blocks
                                                ON swaps.block_number = blocks.number
                              WHERE blocks.timestamp >= $1)

        SELECT token,
               date,
               SUM(delta) as delta
        FROM token_deltas
        GROUP BY token, date
        ORDER BY token, date;
      `,
      values: [after],
    });
  }

  public async getVolumeByTokenByDate(after: Date) {
    return this.client.query<{ token: string; volume: string }>({
      name: `get-volume-by-token-by-date`,
      text: `
          WITH token_deltas AS (SELECT pool_keys.token0       as token,
                                       DATE(blocks.timestamp) as date,
                                       ABS(swaps.delta0)      as delta
                                FROM swaps
                                         INNER JOIN
                                     pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks
                                                    ON swaps.block_number = blocks.number
                                WHERE blocks.timestamp >= $1
                                UNION ALL
                                SELECT pool_keys.token1       as token,
                                       DATE(blocks.timestamp) as date,
                                       ABS(swaps.delta1)      as delta
                                FROM swaps
                                         INNER JOIN
                                     pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                         INNER JOIN blocks on blocks.number = swaps.block_number
                                WHERE blocks.timestamp >= $1)

          SELECT token,
                 date,
                 SUM(delta) as volume
          FROM token_deltas
          GROUP BY token, date
          ORDER BY token, date;
      `,
      values: [after],
    });
  }

  public async getTopPools() {
    return this.client.query<{ token: string; volume: string }>({
      name: `get-top-pools`,
      text: `
          WITH countable_events AS (SELECT pool_key_hash
                                    FROM position_updates
                                             JOIN blocks ON blocks.number = position_updates.block_number
                                    WHERE blocks.timestamp >= $1
                                    UNION ALL
                                    SELECT pool_key_hash
                                    FROM swaps
                                             JOIN blocks ON blocks.number = swaps.block_number
                                    WHERE blocks.timestamp >= $1),
               most_eventful_pools AS (SELECT pool_key_hash
                                       FROM countable_events
                                       GROUP BY pool_key_hash
                                       ORDER BY count(*) DESC
                                       LIMIT 10),
               most_active_pools AS (SELECT key_hash, token0, token1, fee, tick_spacing, extension
                                     FROM pool_keys
                                     WHERE key_hash IN
                                           (SELECT pool_key_hash
                                            FROM most_eventful_pools)),
               volume AS (SELECT swaps.pool_key_hash,
                                 SUM(ABS(swaps.delta0)) as volume0,
                                 SUM(ABS(swaps.delta1)) as volume1
                          FROM swaps
                                   INNER JOIN blocks
                                              ON swaps.block_number = blocks.number
                          WHERE blocks.timestamp >= $2
                            AND swaps.pool_key_hash IN (SELECT pool_key_hash from most_active_pools)
                          GROUP BY swaps.pool_key_hash)
          SELECT most_active_pools.token0,
                 most_active_pools.token1,
                 most_active_pools.fee,
                 most_active_pools.tick_spacing,
                 most_active_pools.extension,
                 COALESCE(volume.volume0, 0) as volume0_24h,
                 COALESCE(volume.volume1, 0) as volume1_24h
          FROM most_active_pools
                   LEFT JOIN volume ON volume.pool_key_hash = most_active_pools.key_hash;
      `,
      values: [
        new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
        new Date(Date.now() - 86_400_000),
      ],
    });
  }
}
