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
                                      UNION
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
                                      UNION
                                      SELECT pool_keys.token1        as token,
                                             position_updates.delta1 as delta
                                      FROM position_updates
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = position_updates.pool_key_hash

                                      UNION
                                      SELECT pool_keys.token0 as token,
                                             swaps.delta0     as delta
                                      FROM swaps
                                               INNER JOIN
                                           pool_keys ON pool_keys.key_hash = swaps.pool_key_hash
                                      UNION
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
}
