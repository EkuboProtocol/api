import { Client } from "pg";
import { Env } from "./env";

export interface PositionMetadata {
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

export interface TwammOrderMetadata {
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
}

export interface ListPoolKeysQueryResult {
  chain_id: string;
  core_address: string;
  pool_id: string;
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: string;
  extension: string;
}

export interface TwammPoolStateQueryResult {
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
  token0_sale_rate: string;
  token1_sale_rate: string;
  last_execution_time: Date;
}

export interface RawErc20TokenRow {
  token_address: string;
  token_symbol: string;
  token_name: string;
  token_decimals: number;
  logo_url: string;
  visibility_priority: number;
  sort_order: number;
  total_supply: string | null;
}

export interface RawErc20TokenBridgeRow {
  source_chain_id: string;
  source_token_address: string;
  source_bridge_address: string;
  dest_chain_id: string;
  dest_token_address: string;
}

export class Queries {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async listErc20Tokens({
    chainId,
    minVisibilityPriority,
    pageSize,
    afterToken,
  }: {
    chainId: bigint;
    minVisibilityPriority: number;
    pageSize: number;
    afterToken: bigint | null;
  }) {
    const { rows } = await this.client.query<RawErc20TokenRow>({
      text: `
        SELECT 
          token_address, token_symbol, token_name, token_decimals,
          logo_url, visibility_priority, sort_order, total_supply
        FROM erc20_tokens
        WHERE chain_id = $1 AND visibility_priority >= $2 AND (token_address > $4::numeric OR $4 IS NULL)
        ORDER BY visibility_priority DESC, token_address
        LIMIT $3
      `,
      values: [chainId, minVisibilityPriority, pageSize, afterToken],
    });
    return rows;
  }

  public async getErc20TokenByAddress({
    chainId,
    tokenAddress,
  }: {
    chainId: bigint;
    tokenAddress: bigint;
  }) {
    const { rows } = await this.client.query<RawErc20TokenRow>({
      text: `
        SELECT 
          chain_id,
          token_address,
          token_symbol,
          token_name,
          token_decimals,
          logo_url,
          visibility_priority,
          sort_order,
          total_supply
        FROM erc20_tokens
        WHERE chain_id = $1 AND token_address = $2
        LIMIT 1
      `,
      values: [chainId, tokenAddress],
    });

    return rows.length > 0 ? rows[0] : null;
  }

  public async getErc20TokenByIdentifier({
    chainId,
    identifier,
  }: {
    chainId: bigint;
    identifier: string;
  }) {
    const { rows } = await this.client.query<RawErc20TokenRow>({
      text: `
        SELECT 
          chain_id,
          token_address,
          token_symbol,
          token_name,
          token_decimals,
          logo_url,
          visibility_priority,
          sort_order,
          total_supply
        FROM erc20_tokens
        WHERE chain_id = $1
          AND token_symbol = $2
        ORDER BY visibility_priority DESC, token_symbol
        LIMIT 1
      `,
      values: [chainId, identifier],
    });

    return rows.length > 0 ? rows[0] : null;
  }

  public async listErc20TokenBridgeRelationships(chainId: bigint) {
    const { rows } = await this.client.query<RawErc20TokenBridgeRow>({
      text: `
        SELECT source_chain_id, source_token_address, source_bridge_address,
               dest_chain_id, dest_token_address
        FROM erc20_tokens_bridge_relationships
        WHERE source_chain_id = $1
    `,
      values: [chainId],
    });
    return rows;
  }

  public async close() {
    await this.client.end();
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

  public async getBlockAtOrAfter(timestamp: string) {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
        SELECT
          number,
          hash,
          time AS timestamp
        FROM blocks
        WHERE time >= $1
        ORDER BY time ASC
        LIMIT 1
      `,
      values: [timestamp],
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

  public async listAllPoolKeys() {
    return this.client.query<ListPoolKeysQueryResult>(`
        SELECT chain_id,
               core_address,
               pool_id,
               token0,
               token1,
               fee,
               tick_spacing,
               extension
        FROM pool_keys
    `);
  }

  public async getPositionMetadata(
    tokenId: bigint,
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
              WHERE pu.salt = token_id
              ORDER BY pu.event_id DESC
              LIMIT 1
              ) AS mint_position_update ON TRUE
                   JOIN pool_keys ON mint_position_update.pool_key_hash = pool_keys.key_hash
                   JOIN event_keys ON pt.event_id = event_keys.id
                   JOIN blocks ON event_keys.block_number = blocks.number
          WHERE token_id = $1
            AND from_address = 0
          LIMIT 1
      `,
      values: [tokenId],
    });

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getTwammOrderMetadata(tokenId: bigint) {
    const { rows } = await this.client.query<TwammOrderMetadata>({
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
          FROM order_transfers AS transfer
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
              WHERE ou.salt = token_id
              GROUP BY ou.key_hash, ou.start_time, ou.end_time
              ) AS order_data ON TRUE
                   JOIN pool_keys ON order_data.pool_key_hash = key_hash
                   JOIN event_keys ON transfer.event_id = event_keys.id
                   JOIN blocks ON event_keys.block_number = blocks.number
          WHERE token_id = $1
            AND from_address = 0
      `,
      values: [tokenId],
    });
    return rows;
  }

  public async getPositionHistory(tokenId: bigint) {
    const { rows } = await this.client.query<
      | {
          type: 0;
          transaction_hash: string;
          timestamp: string;
          block_number: number;
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
          block_number: number;
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
          block_number: number;
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
                                    block_number,
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
                                  block_number,
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
                                          block_number,
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
                                     block_number,
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
                                     block_number,
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
                                     block_number,
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
      values: [tokenId],
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
      core_address: string;

      timestamp: string;

      transaction_hash: string;
      event_id: string;

      delta0: string;
      delta1: string;
    }>({
      text: `
          WITH earliest_event AS (SELECT id
                                  FROM event_keys ek
                                  WHERE ek.block_number >= (SELECT number
                                                           FROM blocks
                                                           WHERE time >= NOW() - INTERVAL '1 days'
                                                           ORDER BY number
                                                           LIMIT 1)
                                  ORDER BY id
                                  LIMIT 1),

               relevant_pool_keys AS (SELECT key_hash, fee, extension, tick_spacing, core_address
                                      FROM pool_keys
                                      WHERE token0 = $1
                                        AND token1 = $2),

               relevant_swaps AS (SELECT 0                           AS type,
                                         relevant_pool_keys.key_hash AS pool_key_hash,
                                         relevant_pool_keys.fee,
                                         relevant_pool_keys.tick_spacing,
                                         relevant_pool_keys.extension,
                                         relevant_pool_keys.core_address,
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
                                           relevant_pool_keys.core_address,
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
                                FROM order_transfers ot1
                                WHERE to_address = $1
                                  AND NOT EXISTS (SELECT 1
                                                  FROM order_transfers ot2
                                                  WHERE ot2.token_id = ot1.token_id
                                                    AND ot2.event_id > ot1.event_id
                                                    AND (CASE WHEN $2 THEN ot2.to_address != 0 ELSE TRUE END)))
          SELECT token_id,
                 sell_token,
                 buy_token,
                 start_time,
                 end_time,
                 fee,
                 block_time_at_start,
                 last_order_update,
                 lcp.last_collect_proceeds,
                 tpw.total_proceeds_withdrawn,
                 tas.total_amount_sold_before_last_update
          FROM owned_tokens AS ot
                   JOIN LATERAL (
              SELECT tou.key_hash,
                     CASE WHEN tou.sale_rate_delta0 != 0 THEN token0 ELSE token1 END AS sell_token,
                     CASE WHEN tou.sale_rate_delta0 != 0 THEN token1 ELSE token0 END AS buy_token,
                     start_time,
                     end_time,
                     fee,
                     MIN(b.time)                                                     AS block_time_at_start,
                     MAX(b.time)                                                     AS last_order_update
              FROM twamm_order_updates tou
                       JOIN pool_keys ON tou.key_hash = pool_keys.key_hash
                       JOIN event_keys ek ON tou.event_id = ek.id
                       JOIN blocks b ON ek.block_number = b.number
              WHERE tou.salt = ot.token_id
              GROUP BY 1, 2, 3, 4, 5, 6
              ) AS distinct_orders ON TRUE
                   LEFT JOIN LATERAL (
              SELECT SUM(
                             CASE WHEN tpw.amount0 != 0 THEN tpw.amount0 ELSE tpw.amount1 END
                     ) AS total_proceeds_withdrawn
              FROM twamm_proceeds_withdrawals tpw
              WHERE tpw.salt = ot.token_id
                AND tpw.key_hash = distinct_orders.key_hash
                AND tpw.start_time = distinct_orders.start_time
                AND tpw.end_time = distinct_orders.end_time
              ) AS tpw ON TRUE
                   LEFT JOIN LATERAL (
              SELECT SUM(
                             FLOOR(ouwsp.sale_rate_after_update * ouwsp.current_state_active_seconds /
                                   pow(2, 32)::NUMERIC)
                     ) AS total_amount_sold_before_last_update
              FROM (SELECT tou.event_id,
                           SUM(
                           CASE WHEN sale_rate_delta1 != 0 THEN sale_rate_delta1 ELSE sale_rate_delta0 END
                              ) OVER (
                               PARTITION BY tou.salt, tou.key_hash, tou.start_time, tou.end_time, tou.owner
                               ORDER BY tou.event_id
                               ) AS sale_rate_after_update,
                           COALESCE(
                                           LEAD(
                                           EXTRACT(EPOCH FROM LEAST(GREATEST(b.time, tou.start_time), tou.end_time)))
                                           OVER (
                                               PARTITION BY tou.salt, tou.key_hash, tou.start_time, tou.end_time, tou.owner
                                               ORDER BY tou.event_id
                                               ) -
                                           EXTRACT(EPOCH FROM LEAST(GREATEST(b.time, tou.start_time), tou.end_time)),
                                           0
                           )     AS current_state_active_seconds
                    FROM twamm_order_updates tou
                             JOIN event_keys e ON tou.event_id = e.id
                             JOIN blocks b ON e.block_number = b.number
                    WHERE tou.salt = ot.token_id
                      AND tou.key_hash = distinct_orders.key_hash
                      AND tou.start_time = distinct_orders.start_time
                      AND tou.end_time = distinct_orders.end_time) ouwsp
              ) AS tas ON TRUE
                   LEFT JOIN LATERAL (SELECT b2.time AS last_collect_proceeds
                                      FROM twamm_proceeds_withdrawals tpw
                                               JOIN event_keys ek2 ON tpw.event_id = ek2.id
                                               JOIN blocks b2 ON ek2.block_number = b2.number
                                      WHERE tpw.salt = ot.token_id
                                      ORDER BY tpw.event_id DESC
                                      LIMIT 1) AS lcp ON TRUE
          WHERE $2
             OR lcp.last_collect_proceeds IS NULL
             OR lcp.last_collect_proceeds < distinct_orders.end_time
          ORDER BY token_id DESC

      `,
      values: [address, showClosed],
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

  public async getVolumeWeightedPrice({
    baseToken,
    quoteToken,
    endTime = new Date(),
    numHours = 24,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    endTime?: Date;
    numHours?: number;
  }): Promise<{ price: number; k_volume: bigint } | null> {
    if (baseToken === quoteToken) return { price: 1, k_volume: 1n << 128n };

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
        ? Number(total) / Number(k_volume)
        : Number(k_volume) / Number(total);
    return { price, k_volume: BigInt(k_volume) };
  }

  public async getPriceHistory({
    token0,
    token1,
    start,
    end,
    intervalSeconds,
    delta0Threshold = 0n,
    delta1Threshold = 0n,
  }: {
    token0: bigint;
    token1: bigint;
    start: Date;
    end: Date;
    intervalSeconds: number;
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
                 SUM(swaps.delta1 * swaps.delta1) / SUM(ABS(swaps.delta0 * swaps.delta1)) AS vwap,
                 MIN(CASE
                         WHEN ABS(swaps.delta0) > $6 AND ABS(swaps.delta1) > $7
                             THEN ABS(swaps.delta1 / swaps.delta0) END) AS min,
                 MAX(CASE
                         WHEN ABS(swaps.delta0) > $6 AND ABS(swaps.delta1) > $7
                             THEN ABS(swaps.delta1 / swaps.delta0) END)  AS max,
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
        delta0Threshold,
        delta1Threshold,
      ],
    });

    return rows;
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
      depth0: string;
      depth1: string;
      min_depth_percent: number | null;
    }>(`
      SELECT
        pk.token0,
        pk.token1,
        sum(volume0_24h) AS volume0_24h,
        sum(volume1_24h) AS volume1_24h,
        sum(fees0_24h) AS fees0_24h,
        sum(fees1_24h) AS fees1_24h,
        sum(tvl0_total) AS tvl0_total,
        sum(tvl1_total) AS tvl1_total,
        sum(tvl0_delta_24h) AS tvl0_delta_24h,
        sum(tvl1_delta_24h) AS tvl1_delta_24h,
        coalesce(sum(depth0), 0::numeric) AS depth0,
        coalesce(sum(depth1), 0::numeric) AS depth1,
        min(depth_percent) AS min_depth_percent
      FROM
        last_24h_pool_stats_materialized l24
        JOIN pool_keys pk ON l24.key_hash = pk.key_hash
        LEFT JOIN token_pair_realized_volatility tprv ON pk.token0 = tprv.token0
          AND pk.token1 = tprv.token1
        LEFT JOIN LATERAL (
          SELECT
            *
          FROM
            pool_market_depth pmd
          WHERE
            pk.key_hash = pmd.pool_key_hash
            AND GREATEST(tprv.realized_volatility, 0.001) >= pmd.depth_percent
          ORDER BY
            depth_percent DESC
          LIMIT 1) AS pmd ON TRUE
      WHERE
        volume0_24h != 0
        OR volume1_24h != 0
        OR tvl0_delta_24h != 0
        OR tvl1_delta_24h != 0
      GROUP BY
        pk.token0,
        pk.token1;
    `);
  }

  public async getTopPools(pair: { token0: bigint; token1: bigint }) {
    return this.client.query<{
      fee: string;
      tick_spacing: number;
      core_address: string;
      extension: string;
      volume0_24h: string;
      volume1_24h: string;
      fees0_24h: string;
      fees1_24h: string;
      tvl0_total: string;
      tvl1_total: string;
      tvl0_delta_24h: string;
      tvl1_delta_24h: string;
      depth0: string;
      depth1: string;
      depth_percent: number | null;
    }>({
      text: `
        SELECT
          p.fee,
          p.tick_spacing,
          p.core_address,
          p.extension,
          volume0_24h,
          volume1_24h,
          fees0_24h,
          fees1_24h,
          tvl0_total,
          tvl1_total,
          tvl0_delta_24h,
          tvl1_delta_24h,
          coalesce(depth0, 0::numeric) AS depth0,
          coalesce(depth1, 0::numeric) AS depth1,
          depth_percent
        FROM
          last_24h_pool_stats_materialized l24
          JOIN pool_keys p ON l24.key_hash = p.key_hash
          LEFT JOIN token_pair_realized_volatility tprv ON p.token0 = tprv.token0
            AND p.token1 = tprv.token1
          LEFT JOIN LATERAL (
            SELECT
              *
            FROM
              pool_market_depth pmd
            WHERE
              p.key_hash = pmd.pool_key_hash
              AND GREATEST(tprv.realized_volatility, 0.001) >= pmd.depth_percent
            ORDER BY
              depth_percent DESC
            LIMIT 1) AS pmd ON TRUE
        WHERE
          p.token0 = $1
          AND p.token1 = $2
          AND (volume0_24h != 0
            OR volume1_24h != 0
            OR tvl0_delta_24h != 0
            OR tvl1_delta_24h != 0);
      `,
      values: [pair.token0, pair.token1],
    });
  }

  public async getPositionsByAddress(address: bigint, showClosed: boolean) {
    return this.client.query<
      PositionMetadata & {
        token_id: string;
        is_closed: boolean;
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
                                                       ON token_id = salt
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
                 blocks.time                 AS minted_timestamp,
                 (ot.liquidity <= 0)         AS is_closed
          FROM filtered_owned_tokens AS ot
                   LEFT JOIN LATERAL (
              SELECT lower_bound, upper_bound, pool_key_hash
              FROM position_updates AS pu
              WHERE pu.salt = token_id
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

  async listCampaigns() {
    return this.client.query<{
      start_time: Date;
      end_time: Date | null;
      name: string;
      slug: string;
      reward_token: string;
      next_drop_time: Date;
      allowed_extensions: string[];
      rewards: {
        depth0: string | null;
        depth1: string | null;
        depth_percent: number | null;
        token0: string;
        token1: string;
        distributed: string;
        scheduled: string;
        daily_rewards: string;
        daily_rewards_token0: string;
        daily_rewards_token1: string;
        realized_volatility: number;
      }[];
    }>(`
        WITH campaign_info AS (
          SELECT
            crp.campaign_id,
            GREATEST (c.start_time + INTERVAL '24 hours', LEAST (CURRENT_TIMESTAMP + INTERVAL '24 hours', max(crp.end_time))) AS latest_end_time
          FROM
            incentives.campaign_reward_periods crp
            JOIN incentives.campaigns c ON crp.campaign_id = c.id
          GROUP BY
            campaign_id,
            c.start_time
        ),
        rewards_by_token AS (
          SELECT
            crp.campaign_id,
            crp.token0,
            crp.token1,
            sum(
              CASE WHEN crp.rewards_last_computed_at IS NULL THEN
                0
              ELSE
                token0_reward_amount + token1_reward_amount
              END) AS distributed,
            sum(
              CASE WHEN crp.end_time <= ci.latest_end_time
                AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours') THEN
                token0_reward_amount
              ELSE
                0
              END) AS daily_rewards_token0,
            sum(
              CASE WHEN crp.end_time <= ci.latest_end_time
                AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours') THEN
                token1_reward_amount
              ELSE
                0
              END) AS daily_rewards_token1,
            sum(
              CASE WHEN crp.end_time <= ci.latest_end_time
                AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours') THEN
                token0_reward_amount + token1_reward_amount
              ELSE
                0
              END) AS daily_rewards,
            sum(token0_reward_amount + token1_reward_amount) AS scheduled,
            avg(
              CASE WHEN crp.end_time <= ci.latest_end_time
                AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours') THEN
                crp.realized_volatility
              ELSE
                NULL
              END) AS realized_volatility
          FROM
            incentives.campaign_reward_periods crp
            JOIN campaign_info ci ON crp.campaign_id = ci.campaign_id
          GROUP BY
            crp.campaign_id,
            crp.token0,
            crp.token1
        ),
        depth_per_campaign_pair AS (
          SELECT
            rbt.campaign_id,
            rbt.token0,
            rbt.token1,
            max(depth_percent) AS depth_percent,
            sum(pd.depth0) AS depth0,
            sum(pd.depth1) AS depth1
          FROM
            rewards_by_token rbt
            LEFT JOIN LATERAL (
              SELECT
                max(depth_percent) as depth_percent,
                max(depth0) AS depth0,
                max(depth1) AS depth1
              FROM
                pool_market_depth pmd
                JOIN pool_keys pk ON pmd.pool_key_hash = pk.key_hash
              WHERE
                pmd.depth_percent <= rbt.realized_volatility * 2
                AND pk.token0 = rbt.token0
                AND pk.token1 = rbt.token1
                AND pk.extension IN (SELECT UNNEST(allowed_extensions) FROM incentives.campaigns c WHERE c.id = rbt.campaign_id)
              GROUP BY
                pool_key_hash) AS pd ON TRUE
            GROUP BY
              rbt.campaign_id,
              rbt.token0,
              rbt.token1
        ),
        campaign_rewards AS (
          SELECT
            rbt.campaign_id,
            jsonb_agg(
              jsonb_build_object(
                'token0', rbt.token0::text,
                'token1', rbt.token1::text,
                'distributed', rbt.distributed::text,
                'scheduled', rbt.scheduled::text,
                'daily_rewards', rbt.daily_rewards::text,
                'daily_rewards_token0', rbt.daily_rewards_token0::text,
                'daily_rewards_token1', rbt.daily_rewards_token1::text,
                'realized_volatility', rbt.realized_volatility::numeric,
                'depth_percent', dpcp.depth_percent,
                'depth0', dpcp.depth0::text,
                'depth1', dpcp.depth1::text
              )
            ) AS rewards
          FROM
            rewards_by_token rbt
            JOIN incentives.campaigns c ON rbt.campaign_id = c.id
            LEFT JOIN depth_per_campaign_pair dpcp ON rbt.campaign_id = dpcp.campaign_id
              AND rbt.token0 = dpcp.token0
              AND rbt.token1 = dpcp.token1
          GROUP BY
            rbt.campaign_id
        )
        SELECT
          slug,
          start_time,
          end_time,
          name,
          reward_token,
          rewards,
          c.allowed_extensions::text[] as allowed_extensions,
          (
            CASE 
            WHEN CURRENT_TIMESTAMP < c.start_time THEN c.start_time + c.distribution_cadence + interval '12 hours'
            WHEN c.end_time IS NULL
              OR CURRENT_TIMESTAMP < c.end_time THEN
              date_bin (c.distribution_cadence, CURRENT_TIMESTAMP + c.distribution_cadence - interval '12 hours', c.start_time) + INTERVAL '12 hours'
            ELSE
              NULL
            END) AS next_drop_time
        FROM
          incentives.campaigns c
          JOIN campaign_rewards cr ON cr.campaign_id = c.id
    `);
  }

  async listRewardsPeriodsForCampaign(slug: string, activeAt?: string) {
    return this.client.query<{
      token0: string;
      token1: string;
      start_time: Date;
      end_time: Date;
      token0_reward_amount: string;
      token1_reward_amount: string;
      realized_volatility: number;
    }>({
      text: `
          SELECT crp.token0,
                 crp.token1,
                 crp.start_time,
                 crp.end_time,
                 token0_reward_amount,
                 token1_reward_amount,
                 realized_volatility
          FROM incentives.campaigns c
                   JOIN incentives.campaign_reward_periods crp ON crp.campaign_id = c.id
          WHERE c.slug = $1
            AND COALESCE($2::timestamptz, CURRENT_TIMESTAMP) >= crp.start_time
            AND COALESCE($2::timestamptz, CURRENT_TIMESTAMP) < crp.end_time
      `,
      values: [slug, activeAt ?? null],
    });
  }

  async listRewardPeriods(activeAt?: string) {
    return this.client.query<{
      slug: string;
      token0: string;
      token1: string;
      start_time: Date;
      end_time: Date;
      token0_reward_amount: string;
      token1_reward_amount: string;
      realized_volatility: number;
    }>({
      text: `
          SELECT c.slug,
                 crp.token0,
                 crp.token1,
                 crp.start_time,
                 crp.end_time,
                 token0_reward_amount,
                 token1_reward_amount,
                 realized_volatility
          FROM incentives.campaigns c
                   JOIN incentives.campaign_reward_periods crp ON crp.campaign_id = c.id
          WHERE COALESCE($1::timestamptz, CURRENT_TIMESTAMP) >= crp.start_time
            AND COALESCE($1::timestamptz, CURRENT_TIMESTAMP) < crp.end_time
      `,
      values: [activeAt ?? null],
    });
  }

  async listComputedRewardsForPosition(
    locker: string,
    salt: string,
    startTime?: string,
    endTime?: string,
    excludeDropped?: boolean,
  ) {
    return this.client.query<{
      slug: string;
      amount: string;
      pending: string;
    }>({
      text: `
          SELECT c.slug,
                 SUM(cr.reward_amount) AS amount,
                 SUM(CASE WHEN gdrp.drop_id IS NULL THEN cr.reward_amount ELSE 0 END) AS pending
          FROM incentives.campaigns c
                   JOIN incentives.campaign_reward_periods crp ON crp.campaign_id = c.id
                   JOIN incentives.computed_rewards cr ON cr.campaign_reward_period_id = crp.id
                   LEFT JOIN incentives.generated_drop_reward_periods gdrp on crp.id = gdrp.campaign_reward_period_id
          WHERE cr.locker = $1
            AND cr.salt = $2
            AND (crp.start_time >= $3::timestamptz OR $3 IS NULL)
            AND (crp.end_time <= $4::timestamptz OR $4 IS NULL)
            AND ($5 IS NOT TRUE OR gdrp.drop_id IS NULL)
          GROUP BY c.slug
      `,
      values: [
        locker,
        salt,
        startTime ?? null,
        endTime ?? null,
        excludeDropped ?? false,
      ],
    });
  }

  async listComputedRewardsForAllPositions(
    ownerAddress: string,
    startTime?: string,
    endTime?: string,
    excludeDropped?: boolean,
  ) {
    return this.client.query<{
      salt: string;
      slug: string;
      amount: string;
      pending: string;
    }>({
      text: `
          WITH keys AS (SELECT ek.emitter AS locker, token_id::NUMERIC AS salt
                        FROM position_transfers pt1
                                 JOIN event_keys ek ON pt1.event_id = ek.id
                        WHERE to_address = $1
                          AND NOT EXISTS (SELECT 1
                                          FROM position_transfers pt2
                                          WHERE pt2.token_id = pt1.token_id
                                            AND pt2.event_id > pt1.event_id
                                            AND pt2.to_address != 0))
          SELECT k.salt,
                 c.slug,
                 SUM(cr.reward_amount) AS amount,
                 SUM(CASE WHEN gdrp.drop_id IS NULL THEN cr.reward_amount ELSE 0 END) AS pending
          FROM incentives.campaigns c
                   JOIN incentives.campaign_reward_periods crp ON crp.campaign_id = c.id
                   JOIN incentives.computed_rewards cr ON cr.campaign_reward_period_id = crp.id
                   JOIN keys k ON cr.locker = k.locker AND cr.salt = k.salt
                   LEFT JOIN incentives.generated_drop_reward_periods gdrp on crp.id = gdrp.campaign_reward_period_id
          WHERE (crp.start_time >= $2::timestamptz OR $2 IS NULL)
            AND (crp.end_time <= $3::timestamptz OR $3 IS NULL)
            AND ($4 IS NOT TRUE OR gdrp.drop_id IS NULL)
          GROUP BY k.salt, c.slug
      `,
      values: [
        ownerAddress,
        startTime ?? null,
        endTime ?? null,
        excludeDropped ?? false,
      ],
    });
  }

  async listAvailableClaimsForAddress(address: string) {
    return this.client.query<{
      slug: string | null;
      owner: string;
      token: string;
      root: string;
      index: number;
      address: string;
      amount: string;
      proof: string[];
    }>({
      text: `
          WITH funded_roots
                   AS (SELECT ROW_NUMBER() OVER (PARTITION BY if.owner, if.token, if.root ORDER BY event_id DESC) if_no,
                              if.owner,
                              if.token,
                              if.root
                       FROM incentives_funded if),

               last_funded_roots AS (SELECT owner, token, root
                                     FROM funded_roots
                                     WHERE if_no = 1),

               funded_drops AS (SELECT fr.owner, fr.token, gd.root, gd.id
                                FROM incentives.generated_drop gd
                                         JOIN last_funded_roots fr ON gd.root = fr.root)

          SELECT (SELECT slug
                  FROM incentives.campaign_reward_periods crp
                           JOIN incentives.campaigns c ON crp.campaign_id = c.id
                  WHERE crp.id IN (SELECT campaign_reward_period_id
                                   FROM incentives.generated_drop_reward_periods gdrp
                                   WHERE gdrp.drop_id = gdp.drop_id)
                  LIMIT 1) AS slug,
                 owner,
                 token,
                 root,
                 gdp.id    AS index,
                 address,
                 amount,
                 proof::TEXT[]
          FROM incentives.generated_drop_proof gdp
                   JOIN funded_drops fd ON gdp.drop_id = fd.id
          WHERE address = $1
      `,
      values: [address],
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
