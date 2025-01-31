import { Client } from "pg";
import { Env } from "./env";

interface PositionMetadata {
  positions_address: string;
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
  core_address: string;
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
    return this.client.query<BasePoolStateQueryResult>(`
        SELECT core_address,
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

  public async getPositionMetadata(
    id: number,
  ): Promise<PositionMetadata | null> {
    const { rows, rowCount } = await this.client.query<PositionMetadata>({
      text: `
          SELECT event_keys.transaction_hash AS minted_tx_hash,
                 mint_position_update.lower_bound,
                 mint_position_update.upper_bound,
                 event_keys.emitter          AS positions_address,
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
                              FROM fee_collections)
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

  public getPoolLiquidityGraph(key: {
    coreAddress: bigint;
    token0: bigint;
    token1: bigint;
    fee: bigint;
    tickSpacing: number;
    extension: bigint;
  }) {
    return this.client.query<{
      tick: string;
      net_liquidity_delta_diff: string;
    }>({
      text: `
          SELECT tick, net_liquidity_delta_diff
          FROM per_pool_per_tick_liquidity_incremental_view
          WHERE pool_key_hash = (SELECT key_hash
                                 FROM pool_keys
                                 WHERE core_address = $1
                                   AND token0 = $2
                                   AND token1 = $3
                                   AND fee = $4
                                   AND tick_spacing = $5
                                   AND extension = $6
                                 LIMIT 1)
          ORDER BY tick
      `,
      values: [
        key.coreAddress,
        key.token0,
        key.token1,
        key.fee,
        key.tickSpacing,
        key.extension,
      ],
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
                 event_keys.emitter as positions_address,
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
              ORDER BY event_id
              LIMIT 1
              ) AS mint_tx ON TRUE
                   JOIN event_keys ON mint_tx.event_id = event_keys.id
                   JOIN pool_keys ON mint_position_update.pool_key_hash = pool_keys.key_hash
                   JOIN blocks ON event_keys.block_number = blocks.number
          WHERE ($2 OR ot.liquidity > 0)
          ORDER BY blocks.time DESC
      `,
      values: [address, showClosed],
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
