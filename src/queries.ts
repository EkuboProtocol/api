import postgres, { type Sql } from "postgres";
import { Env } from "./env";

type QueryConfig = {
  text: string;
  values?: ReadonlyArray<unknown>;
};

interface QueryResult<TRow> {
  rows: TRow[];
  rowCount: number;
}

interface QueryClient {
  query<TRow>(config: QueryConfig): Promise<QueryResult<TRow>>;
}

class PostgresQueryClient implements QueryClient {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  public async query<TRow>({
    text,
    values,
  }: QueryConfig): Promise<QueryResult<TRow>> {
    const params = values != null ? [...values] : [];
    const result = await this.sql.unsafe<TRow[]>(text, params as any[]);
    const rows = result as TRow[];
    const count =
      typeof (result as unknown as { count?: number }).count === "number"
        ? (result as unknown as { count: number }).count
        : rows.length;

    return { rows, rowCount: count };
  }
}

export interface PositionMetadata {
  minted_tx_hash: string;
  minted_timestamp: Date;
  positions_address: string;
  lower_bound: string;
  upper_bound: string;
  token0: string;
  token1: string;
  fee: string;
  fee_denominator: string;
  tick_spacing: string;
  extension: string;
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
  pool_key_id: string;
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

export class Queries {
  private readonly client: QueryClient;

  constructor(client: QueryClient) {
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

  public async getLatestBlock(chainId: bigint) {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
          SELECT block_number AS number, block_hash AS hash, block_time AS timestamp
          FROM blocks
          WHERE chain_id = $1
          ORDER BY block_number DESC
          LIMIT 1
      `,
      values: [chainId],
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getBlockAtOrAfter(timestamp: string, chainId: bigint) {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
        SELECT
          block_number AS number,
          block_hash AS hash,
          block_time AS timestamp
        FROM blocks
        WHERE chain_id = $1
          AND block_time >= $2
        ORDER BY block_time ASC
        LIMIT 1
      `,
      values: [chainId, timestamp],
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getBlock(blockNumber: number, chainId: bigint) {
    const { rows } = await this.client.query<{
      number: string;
      timestamp: string;
    }>({
      text: `
          SELECT block_number AS number, block_time AS timestamp
          FROM blocks
          WHERE chain_id = $1
            AND block_number = $2
      `,
      values: [chainId, blockNumber],
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async listAllPoolKeys(chainId?: bigint | null) {
    return this.client.query<ListPoolKeysQueryResult>({
      text: `
        SELECT chain_id,
               core_address,
               pool_id,
               token0,
               token1,
               fee,
               tick_spacing,
               pool_extension AS extension
        FROM pool_keys
        WHERE chain_id = COALESCE($1, chain_id)
    `,
      values: [chainId],
    });
  }

  public async getPositionMetadata(
    chainId: bigint,
    nftAddress: bigint,
    tokenId: bigint,
  ): Promise<PositionMetadata | null> {
    const { rows, rowCount } = await this.client.query<PositionMetadata>({
      text: `
        SELECT
          transaction_hash AS minted_tx_hash,
          mint_position_update.lower_bound,
          mint_position_update.upper_bound,
          emitter AS positions_address,
          pk.token0,
          pk.token1,
          pk.fee,
          pk.fee_denominator,
          pk.tick_spacing,
          pk.pool_extension AS extension,
          b.block_time AS minted_timestamp
        FROM
          nonfungible_token_transfers AS nft
          JOIN blocks b USING (block_number, chain_id)
          JOIN LATERAL (
            SELECT
              lower_bound,
              upper_bound,
              pool_key_id
            FROM
              position_updates AS pu
            WHERE
              pu.salt = nft.token_id
              AND pu.locker = nft.emitter
              AND pu.chain_id = $2
            ORDER BY
              pu.event_id DESC
            LIMIT 1) AS mint_position_update ON TRUE
          JOIN pool_keys pk USING (pool_key_id)
        WHERE
          nft.token_id = $1
          AND from_address = 0
          AND nft.chain_id = $2
          AND nft.emitter = $3
        LIMIT 1
      `,
      values: [tokenId, chainId, nftAddress],
    });

    if (rowCount !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getTwammOrderMetadata(tokenId: bigint, chainId: bigint) {
    const { rows } = await this.client.query<TwammOrderMetadata>({
      text: `
          SELECT transaction_hash AS minted_tx_hash,
                 blocks.block_time          AS minted_timestamp,
                 start_time,
                 end_time,
                 last_update_time,
                 token0,
                 sale_rate0,
                 token1,
                 sale_rate1,
                 fee
          FROM nonfungible_token_transfers AS transfer
                   LEFT JOIN LATERAL (
              SELECT ou.pool_key_id           AS pool_key_id,
                     ou.start_time         AS start_time,
                     ou.end_time           AS end_time,
                     MAX(b.block_time)     AS last_update_time,
                     SUM(sale_rate_delta0) AS sale_rate0,
                     SUM(sale_rate_delta1) AS sale_rate1
              FROM twamm_order_updates AS ou
                       JOIN blocks b ON ou.block_number = b.block_number
                                     AND b.chain_id = $2
              WHERE ou.salt = transfer.token_id
                AND ou.chain_id = $2
              GROUP BY ou.pool_key_id, ou.start_time, ou.end_time
              ) AS order_data ON TRUE
                  JOIN pool_keys ON order_data.pool_key_id = pool_keys.pool_key_id
                 AND pool_keys.chain_id = $2
                  JOIN blocks ON transfer.block_number = blocks.block_number AND blocks.chain_id = $2
          WHERE transfer.token_id = $1
            AND from_address = 0
            AND transfer.chain_id = $2
      `,
      values: [tokenId, chainId],
    });
    return rows;
  }

  public async getPositionHistory(tokenId: bigint, chainId: bigint) {
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
                                    block_time AS timestamp,
                                    block_number,
                                    from_address,
                                    to_address
                             FROM nonfungible_token_transfers
                                      JOIN event_keys ek ON event_id = id
                                      JOIN blocks b ON nonfungible_token_transfers.block_number = b.block_number
                                                     AND nonfungible_token_transfers.chain_id = b.chain_id
                             WHERE token_id = $1
                               AND from_address != 0
                               AND to_address != 0
                               AND nonfungible_token_transfers.chain_id = $2
                               AND ek.chain_id = $2
                               AND b.chain_id = $2),
               updates AS (SELECT transaction_hash,
                                  block_time AS timestamp,
                                  block_number,
                                  liquidity_delta,
                                  delta0,
                                  delta1
                           FROM nonfungible_token_transfers AS nft
                                    JOIN position_updates AS pu ON pu.salt = nft.token_id
                                    JOIN event_keys AS puek ON pu.event_id = puek.id
                                    JOIN blocks AS b ON puek.block_number = b.block_number
                                                   AND puek.chain_id = b.chain_id
                           WHERE nft.token_id = $1
                             AND from_address = 0
                             AND nft.chain_id = $2
                             AND pu.chain_id = $2
                             AND puek.chain_id = $2
                             AND b.chain_id = $2),
               fee_collections AS (SELECT transaction_hash,
                                          block_time AS timestamp,
                                          block_number,
                                          delta0,
                                          delta1
                                   FROM nonfungible_token_transfers AS nft
                                            JOIN position_fees_collected AS pfc ON pfc.salt = nft.token_id
                                            JOIN event_keys AS puek ON pfc.event_id = puek.id
                                            JOIN blocks AS b ON puek.block_number = b.block_number
                                                           AND puek.chain_id = b.chain_id
                                   WHERE nft.token_id = $1
                                     AND from_address = 0
                                     AND nft.chain_id = $2
                                     AND pfc.chain_id = $2
                                     AND puek.chain_id = $2
                                     AND b.chain_id = $2),
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
      values: [tokenId, chainId],
    });
    return rows;
  }

  public async getPairLiquidityGraph({
    token0,
    token1,
    chainId,
  }: {
    token0: bigint;
    token1: bigint;
    chainId: bigint;
  }) {
    const { rows } = await this.client.query<{
      tick: string;
      net_liquidity_delta_diff: string;
    }>({
      text: `
          SELECT tick, SUM(net_liquidity_delta_diff) AS net_liquidity_delta_diff
          FROM per_pool_per_tick_liquidity_incremental_view
                   JOIN pool_keys ON pool_key_id = pool_key_id
          WHERE net_liquidity_delta_diff != 0
            AND token0 = $1
            AND token1 = $2
            AND pool_keys.chain_id = $3
          GROUP BY tick
         ORDER BY tick
      `,
      values: [token0, token1, chainId],
    });
    return rows;
  }

  public getPoolLiquidityGraph(
    key: {
      coreAddress: bigint;
      token0: bigint;
      token1: bigint;
      fee: bigint;
      tickSpacing: number;
      extension: bigint;
    },
    chainId: bigint,
  ) {
    return this.client.query<{
      tick: string;
      net_liquidity_delta_diff: string;
    }>({
      text: `
          SELECT tick, net_liquidity_delta_diff
          FROM per_pool_per_tick_liquidity_incremental_view
          WHERE pool_key_id = (SELECT pool_key_id
                                 FROM pool_keys
                                 WHERE core_address = $1
                                   AND token0 = $2
                                   AND token1 = $3
                                   AND fee = $4
                                   AND tick_spacing = $5
                                   AND extension = $6
                                   AND chain_id = $7
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
        chainId,
      ],
    });
  }

  public async getPoolClassification({
    chainId,
    token0,
    token1,
    fee,
    tickSpacing,
    extension,
  }: {
    chainId: bigint;
    token0: bigint;
    token1: bigint;
    fee: bigint;
    tickSpacing: number;
    extension: bigint;
  }): Promise<{
    is_twamm: boolean;
    is_oracle: boolean;
    is_mev_capture: boolean;
  } | null> {
    const { rows } = await this.client.query<{
      is_twamm: boolean;
      is_oracle: boolean;
      is_mev_capture: boolean;
    }>({
      text: `
        SELECT
          EXISTS (
            SELECT 1
            FROM twamm_pool_states
            WHERE pool_key_id = pk.pool_key_id
          ) AS is_twamm,
          EXISTS (
            SELECT 1
            FROM oracle_pool_states
            WHERE pool_key_id = pk.pool_key_id
          ) AS is_oracle,
          EXISTS (
            SELECT 1
            FROM mev_capture_pool_keys
            WHERE pool_key_id = pk.pool_key_id
          ) AS is_mev_capture
        FROM pool_keys pk
        WHERE pk.chain_id = $1
          AND pk.token0 = $2
          AND pk.token1 = $3
          AND pk.fee = $4
          AND pk.tick_spacing = $5
          AND pk.pool_extension = $6
        LIMIT 1
      `,
      values: [chainId, token0, token1, fee, tickSpacing, extension],
    });

    return rows[0] ?? null;
  }

  public getPairEvents({
    token0,
    token1,
    limit,
    chainId,
  }: {
    token0: bigint;
    token1: bigint;
    limit: number;
    chainId: bigint;
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
                                  WHERE ek.chain_id = $3
                                    AND ek.block_number >= (SELECT block_number
                                                            FROM blocks
                                                            WHERE block_time >= NOW() - INTERVAL '1 days'
                                                              AND chain_id = $3
                                                            ORDER BY block_number
                                                            LIMIT 1)
                                  ORDER BY id
                                  LIMIT 1),

               relevant_pool_keys AS (SELECT pool_key_id, fee, pool_extension AS extension, tick_spacing, core_address
                                      FROM pool_keys
                                      WHERE token0 = $1
                                        AND token1 = $2
                                        AND chain_id = $3),

               relevant_swaps AS (SELECT 0                           AS type,
                                         relevant_pool_keys.pool_key_id AS pool_key_id,
                                        relevant_pool_keys.fee,
                                        relevant_pool_keys.tick_spacing,
                                        relevant_pool_keys.extension,
                                         relevant_pool_keys.core_address,
                                         blocks.block_time          AS timestamp,
                                         transaction_hash,
                                         event_id,
                                         locker,
                                         delta0,
                                         delta1
                                  FROM swaps
                                          JOIN relevant_pool_keys ON pool_key_id = pool_key_id
                                          JOIN event_keys ON swaps.event_id = event_keys.id
                                          JOIN blocks ON event_keys.block_number = blocks.block_number,
                                       earliest_event
                                  WHERE event_id >= earliest_event.id
                                    AND swaps.chain_id = $3
                                    AND event_keys.chain_id = $3
                                    AND blocks.chain_id = $3),
               relevant_updates AS (SELECT 1                           AS type,
                                           relevant_pool_keys.pool_key_id AS pool_key_id,
                                           relevant_pool_keys.fee,
                                          relevant_pool_keys.tick_spacing,
                                          relevant_pool_keys.extension,
                                           relevant_pool_keys.core_address,
                                           blocks.block_time          AS timestamp,
                                           transaction_hash,
                                           event_id,
                                           locker,
                                           delta0,
                                           delta1
                                    FROM position_updates
                                             JOIN relevant_pool_keys
                                                  ON pool_key_id = pool_key_id
                                             JOIN event_keys ON position_updates.event_id = event_keys.id
                                             JOIN blocks ON event_keys.block_number = blocks.block_number,
                                         earliest_event
                                   WHERE event_id >= earliest_event.id
                                     AND position_updates.chain_id = $3
                                     AND event_keys.chain_id = $3
                                     AND blocks.chain_id = $3),
               combined AS (SELECT *
                            FROM relevant_updates
                            UNION ALL
                            SELECT *
                            FROM relevant_swaps)

          SELECT *
          FROM combined
          ORDER BY event_id DESC
          LIMIT $4
      `,
      values: [token0, token1, chainId, limit],
    });
  }

  public getRevenueByToken({
    since = new Date(0),
    pair,
    chainId = null,
  }: {
    since?: Date;
    pair?: { token0: bigint; token1: bigint };
    chainId?: bigint | null;
  }) {
    if (!pair) {
      return this.client.query<{ token: string; revenue: string }>({
        text: `
            SELECT hrbt.token,
                   SUM(revenue) AS revenue
            FROM hourly_revenue_by_token hrbt
                     JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
            WHERE hour >= $1
              AND pk.chain_id = COALESCE($2, pk.chain_id)
            GROUP BY hrbt.token
        `,
        values: [since, chainId],
      });
    }

    return this.client.query<{ token: string; revenue: string }>({
      text: `
          SELECT hrbt.token,
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token hrbt
                   JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
          WHERE hrbt.hour >= $1
            AND pk.token0 = $2
            AND pk.token1 = $3
            AND pk.chain_id = COALESCE($4, pk.chain_id)
          GROUP BY hrbt.token
      `,
      values: [since, pair.token0, pair.token1, chainId],
    });
  }

  public getTvlByToken(
    chainId: bigint,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.client.query<{ token: string; balance: string }>({
      text: `
          WITH summed0 AS (SELECT pk.token0          AS token,
                        SUM(ptvl.balance0) AS balance
                 FROM pool_tvl ptvl
                          JOIN pool_keys pk USING (pool_key_id)
                 WHERE pk.token0 = COALESCE($1, pk.token0)
                   AND pk.token1 = COALESCE($2, pk.token1)
                   AND pk.chain_id = $3
                 GROUP BY pk.token0),
              summed1 AS (SELECT pk.token1          AS token,
                                  SUM(ptvl.balance1) AS balance
                          FROM pool_tvl ptvl
                                    JOIN pool_keys pk USING (pool_key_id)
                          WHERE pk.token0 = COALESCE($1, pk.token0)
                            AND pk.token1 = COALESCE($2, pk.token1)
                            AND pk.chain_id = $3
                          GROUP BY pk.token1),
              all_balances AS (SELECT *
                                FROM summed0
                                UNION ALL
                                SELECT *
                                FROM summed1)
          SELECT token, SUM(balance) AS balance
          FROM all_balances
          GROUP BY token;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, chainId],
    });
  }

  public getTvlDeltaByTokenByDate(
    chainId: bigint,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.client.query<{ token: string; date: string; balance: string }>({
      text: `
          SELECT htd.token,
                 DATE_TRUNC('day', hour, 'UTC') AS date,
                 SUM(delta)                     AS delta
          FROM hourly_tvl_delta_by_token htd
                   JOIN pool_keys pk ON pk.pool_key_id = htd.pool_key_id
          WHERE hour >= $3
            AND pk.token0 = COALESCE($1, pk.token0)
            AND pk.token1 = COALESCE($2, pk.token1)
            AND pk.chain_id = $4
          GROUP BY htd.token, date;
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after, chainId],
    });
  }

  public async getTwammOrdersByAddress(
    address: bigint,
    showClosed: boolean,
    chainId?: bigint | null,
  ) {
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
                                FROM nonfungible_token_transfers ot1
                                WHERE to_address = $1
                                  AND ot1.chain_id = COALESCE($3, ot1.chain_id)
                                  AND NOT EXISTS (SELECT 1
                                                  FROM nonfungible_token_transfers ot2
                                                  WHERE ot2.token_id = ot1.token_id
                                                    AND ot2.event_id > ot1.event_id
                                                    AND ot2.chain_id = COALESCE($3, ot2.chain_id)
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
              SELECT tou.pool_key_id,
                     CASE WHEN tou.sale_rate_delta0 != 0 THEN token0 ELSE token1 END AS sell_token,
                     CASE WHEN tou.sale_rate_delta0 != 0 THEN token1 ELSE token0 END AS buy_token,
                     start_time,
                     end_time,
                     fee,
	                     MIN(b.block_time)                                               AS block_time_at_start,
	                     MAX(b.block_time)                                               AS last_order_update
              FROM twamm_order_updates tou
                       JOIN pool_keys ON tou.pool_key_id = pool_keys.pool_key_id
                       JOIN event_keys ek ON tou.event_id = ek.id
                       JOIN blocks b ON ek.block_number = b.block_number
              WHERE tou.salt = ot.token_id
                AND tou.chain_id = COALESCE($3, tou.chain_id)
                AND pool_keys.chain_id = COALESCE($3, pool_keys.chain_id)
                AND ek.chain_id = COALESCE($3, ek.chain_id)
                AND b.chain_id = COALESCE($3, b.chain_id)
              GROUP BY 1, 2, 3, 4, 5, 6
              ) AS distinct_orders ON TRUE
                   LEFT JOIN LATERAL (
              SELECT SUM(
                             CASE WHEN tpw.amount0 != 0 THEN tpw.amount0 ELSE tpw.amount1 END
                     ) AS total_proceeds_withdrawn
              FROM twamm_proceeds_withdrawals tpw
              WHERE tpw.salt = ot.token_id
                AND tpw.pool_key_id = distinct_orders.pool_key_id
                AND tpw.start_time = distinct_orders.start_time
                AND tpw.end_time = distinct_orders.end_time
                AND tpw.chain_id = COALESCE($3, tpw.chain_id)
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
                               PARTITION BY tou.salt, tou.pool_key_id, tou.start_time, tou.end_time, tou.owner
                               ORDER BY tou.event_id
                               ) AS sale_rate_after_update,
                           COALESCE(
                                           LEAD(
                                           EXTRACT(EPOCH FROM LEAST(GREATEST(b.block_time, tou.start_time), tou.end_time)))
                                           OVER (
                                               PARTITION BY tou.salt, tou.pool_key_id, tou.start_time, tou.end_time, tou.owner
                                               ORDER BY tou.event_id
                                               ) -
                                           EXTRACT(EPOCH FROM LEAST(GREATEST(b.block_time, tou.start_time), tou.end_time)),
                                           0
                           )     AS current_state_active_seconds
                    FROM twamm_order_updates tou
                        JOIN event_keys e ON tou.event_id = e.id
                        JOIN blocks b ON e.block_number = b.block_number
                    WHERE tou.salt = ot.token_id
                      AND tou.pool_key_id = distinct_orders.pool_key_id
                      AND tou.start_time = distinct_orders.start_time
                      AND tou.end_time = distinct_orders.end_time
                      AND tou.chain_id = COALESCE($3, tou.chain_id)
                      AND e.chain_id = COALESCE($3, e.chain_id)
                      AND b.chain_id = COALESCE($3, b.chain_id)) ouwsp
              ) AS tas ON TRUE
                   LEFT JOIN LATERAL (SELECT b2.block_time AS last_collect_proceeds
                                      FROM twamm_proceeds_withdrawals tpw
                                               JOIN event_keys ek2 ON tpw.event_id = ek2.id
                                               JOIN blocks b2 ON ek2.block_number = b2.block_number
                                      WHERE tpw.salt = ot.token_id
                                         AND tpw.chain_id = COALESCE($3, tpw.chain_id)
                                         AND ek2.chain_id = COALESCE($3, ek2.chain_id)
                                         AND b2.chain_id = COALESCE($3, b2.chain_id)
                                      ORDER BY tpw.event_id DESC
                                      LIMIT 1) AS lcp ON TRUE
          WHERE $2
             OR lcp.last_collect_proceeds IS NULL
             OR lcp.last_collect_proceeds < distinct_orders.end_time
          ORDER BY token_id DESC

      `,
      values: [address, showClosed, chainId],
    });
  }

  public async getTwammPoolStateByKey({
    token0,
    token1,
    fee,
    chainId = null,
  }: {
    token0: bigint;
    token1: bigint;
    fee?: bigint;
    chainId?: bigint | null;
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
                   JOIN pool_states_materialized psm ON psm.pool_key_id = tpsm.pool_key_id
                   JOIN pool_keys pk ON tpsm.pool_key_id = pk.pool_key_id
          WHERE pk.token0 = $1
            AND pk.token1 = $2
            AND pk.fee = COALESCE($3, pk.fee)
            AND pk.chain_id = COALESCE($4, pk.chain_id)
      `,
      values: [token0, token1, fee ?? null, chainId],
    });
  }

  public async getSaleRateDeltasByKey({
    token0,
    token1,
    fee,
    chainId = null,
  }: {
    token0: bigint;
    token1: bigint;
    fee?: bigint;
    chainId?: bigint | null;
  }) {
    return this.client.query<{
      time: Date;
      net_sale_rate_delta0: string;
      net_sale_rate_delta1: string;
    }>({
      text: `
          SELECT time, net_sale_rate_delta0, net_sale_rate_delta1
          FROM twamm_sale_rate_deltas_materialized AS tsrdm
                   JOIN pool_keys pk ON tsrdm.pool_key_id = pk.pool_key_id
          WHERE pk.token0 = $1
            AND pk.token1 = $2
            AND pk.fee = COALESCE($3, pk.fee)
            AND pk.chain_id = COALESCE($4, pk.chain_id)
          ORDER BY time
      `,
      values: [token0, token1, fee ?? null, chainId],
    });
  }

  public async getVolumeWeightedPrice({
    baseToken,
    quoteToken,
    endTime = new Date(),
    numHours = 24,
    chainId = null,
  }: {
    baseToken: bigint;
    quoteToken: bigint;
    endTime?: Date;
    numHours?: number;
    chainId?: bigint | null;
  }): Promise<{ price: number; k_volume: bigint } | null> {
    if (baseToken === quoteToken) return { price: 1, k_volume: 1n << 128n };

    const [token0, token1] =
      baseToken < quoteToken
        ? [baseToken, quoteToken]
        : [quoteToken, baseToken];
    const { rows } = await this.client.query<{
      total: string | null;
      k_volume: string | null;
    }>({
      text: `
          SELECT SUM(total) AS total, SUM(k_volume) AS k_volume
          FROM hourly_price_data
          WHERE token0 = $1
            AND token1 = $2
            AND hour BETWEEN (DATE_TRUNC('hour', $3::timestamptz - ($4 * INTERVAL '1 hour'), 'UTC')) AND DATE_TRUNC('hour', $3::timestamptz, 'UTC')
            AND chain_id = COALESCE($5, chain_id)
      `,
      values: [token0, token1, endTime, numHours, chainId],
    });

    if (rows.length !== 1) return null;

    const { total, k_volume } = rows[0];

    if (!total || !k_volume) return null;

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
    chainId = null,
  }: {
    token0: bigint;
    token1: bigint;
    start: Date;
    end: Date;
    intervalSeconds: number;
    delta0Threshold?: bigint;
    delta1Threshold?: bigint;
    chainId?: bigint | null;
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
          SELECT date_bin($5 * INTERVAL '1 sec', blocks.block_time,
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
                        ON swaps.pool_key_id = pool_keys.pool_key_id
                   JOIN event_keys ON swaps.event_id = event_keys.id
                   JOIN blocks ON event_keys.block_number = blocks.block_number
          WHERE pool_keys.token0 = $1
            AND pool_keys.token1 = $2
            AND blocks.block_time BETWEEN $3 AND $4
            AND swaps.delta0 != 0
            AND swaps.delta1 != 0
            AND pool_keys.chain_id = COALESCE($8, pool_keys.chain_id)
            AND swaps.chain_id = COALESCE($8, swaps.chain_id)
            AND event_keys.chain_id = COALESCE($8, event_keys.chain_id)
            AND blocks.chain_id = COALESCE($8, blocks.chain_id)
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
        chainId,
      ],
    });

    return rows;
  }

  public getTotalVolumeByToken({
    chainId,
    since = new Date(0),
    pair,
  }: {
    chainId: bigint;
    since?: Date;
    pair?: { token0: bigint; token1: bigint };
  }) {
    return this.client.query<{ token: string; volume: string }>({
      text: `
          SELECT hvbt.token,
                 SUM(volume) AS volume,
                 SUM(fees)   AS fees
          FROM hourly_volume_by_token hvbt
                   JOIN pool_keys pk ON pk.pool_key_id = hvbt.pool_key_id
          WHERE hour >= $3
            AND pk.token0 = COALESCE($1, pk.token0)
            AND pk.token1 = COALESCE($2, pk.token1)
            AND pk.chain_id = $4
          GROUP BY hvbt.token
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, since, chainId],
    });
  }

  public async getVolumeByTokenByDate(
    chainId: bigint,
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
          SELECT hvbt.token,
                 DATE_TRUNC('day', hour, 'UTC') AS date,
                 SUM(volume)                    AS volume,
                 SUM(fees)                      AS fees
          FROM hourly_volume_by_token hvbt
                   JOIN pool_keys pk ON pk.pool_key_id = hvbt.pool_key_id
          WHERE hour >= $3
            AND pk.token0 = COALESCE($1, pk.token0)
            AND pk.token1 = COALESCE($2, pk.token1)
            AND pk.chain_id = $4
          GROUP BY hvbt.token, date
      `,
      values: [pair?.token0 ?? null, pair?.token1 ?? null, after, chainId],
    });
  }

  public async getRevenueByTokenByDate(
    chainId: bigint,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    if (!pair) {
      return this.client.query<{ token: string; volume: string }>({
        text: `
            SELECT hrbt.token,
                   DATE_TRUNC('day', hour, 'UTC') as date,
                   SUM(revenue) AS revenue
            FROM hourly_revenue_by_token hrbt
                     JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
            WHERE hour >= $1
              AND pk.chain_id = $2
            GROUP BY 1, 2
            ORDER BY 1, 2;
        `,
        values: [after, chainId],
      });
    }

    return this.client.query<{ token: string; volume: string }>({
      text: `
          SELECT token,
                 DATE_TRUNC('day', hour, 'UTC') as date,
                 SUM(revenue) AS revenue
          FROM hourly_revenue_by_token hrbt
                   JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
          WHERE hour >= $1
            AND pk.token0 = $2
            AND pk.token1 = $3
            AND pk.chain_id = $4
          GROUP BY 1, 2
          ORDER BY 1, 2;
      `,
      values: [after, pair.token0, pair.token1, chainId],
    });
  }

  public async getTopPairs(chainId: bigint | null = null) {
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
    }>({
      text: `
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
        JOIN pool_keys pk ON l24.pool_key_id = pk.pool_key_id
        LEFT JOIN token_pair_realized_volatility_materialized tprv ON pk.token0 = tprv.token0
          AND pk.token1 = tprv.token1
        LEFT JOIN LATERAL (
          SELECT
            *
          FROM
            pool_market_depth_materialized pmd
          WHERE
            pk.pool_key_id = pmd.pool_key_id
            AND GREATEST(tprv.realized_volatility, 0.001) >= pmd.depth_percent
          ORDER BY
            depth_percent DESC
          LIMIT 1) AS pmd ON TRUE
      WHERE
        pk.chain_id = COALESCE($1, pk.chain_id)
        AND (
          volume0_24h != 0
          OR volume1_24h != 0
          OR tvl0_delta_24h != 0
          OR tvl1_delta_24h != 0
        )
      GROUP BY
        pk.token0,
        pk.token1;
    `,
      values: [chainId],
    });
  }

  public async getTopPools(
    chainId: bigint,
    pair: { token0: bigint; token1: bigint },
  ) {
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
          p.pool_extension AS extension,
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
          JOIN pool_keys p ON l24.pool_key_id = p.pool_key_id
          LEFT JOIN token_pair_realized_volatility_materialized tprv ON p.token0 = tprv.token0
            AND p.token1 = tprv.token1
          LEFT JOIN LATERAL (
            SELECT
              *
            FROM
              pool_market_depth_materialized pmd
            WHERE
              p.pool_key_id = pmd.pool_key_id
              AND GREATEST(tprv.realized_volatility, 0.001) >= pmd.depth_percent
            ORDER BY
              depth_percent DESC
            LIMIT 1) AS pmd ON TRUE
        WHERE
          p.token0 = $1
          AND p.token1 = $2
          AND p.chain_id = COALESCE($3, p.chain_id)
          AND (volume0_24h != 0
            OR volume1_24h != 0
            OR tvl0_delta_24h != 0
            OR tvl1_delta_24h != 0);
      `,
      values: [pair.token0, pair.token1, chainId],
    });
  }

  public async getPositionsByAddress(
    address: bigint,
    showClosed: boolean,
    chainId: bigint | null = null,
  ) {
    return this.client.query<
      PositionMetadata & {
        chain_id: string;
        token_id: string;
        liquidity: string;
        nft_address: string;
      }
    >({
      text: `
SELECT nfp.chain_id,
       nft_address,
       core_address,
       COALESCE(nlm.locker, nfp.nft_address) AS positions_address,
       token_id,
       token0,
       token1,
       fee,
       tick_spacing,
       pool_extension                        AS "extension",
       lower_bound,
       upper_bound,
       liquidity
FROM nonfungible_token_positions_view AS nfp
         LEFT JOIN nft_locker_mappings nlm USING (chain_id, nft_address)
         JOIN pool_keys USING (pool_key_id)
WHERE nfp.chain_id = COALESCE($3, nfp.chain_id)
  AND ($2 OR nfp.liquidity != 0)
  AND (current_owner = $1
    OR ($2 AND previous_owner = $1))
ORDER BY last_transfer_event_id DESC;
      `,
      values: [address, showClosed, chainId],
    });
  }

  async listCampaigns(chainId: bigint | null = null) {
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
    }>({
      text: `
        WITH campaign_info AS (
          SELECT
            crp.campaign_id,
            GREATEST(
              c.start_time + INTERVAL '24 hours',
              LEAST(CURRENT_TIMESTAMP + INTERVAL '24 hours', MAX(crp.end_time))
            ) AS latest_end_time
          FROM incentives.campaign_reward_periods crp
          JOIN incentives.campaigns c ON crp.campaign_id = c.id
          WHERE c.chain_id = COALESCE($1, c.chain_id)
          GROUP BY crp.campaign_id, c.start_time
        ),
        rewards_by_token AS (
          SELECT
            crp.campaign_id,
            crp.token0,
            crp.token1,
            SUM(
              CASE
                WHEN crp.rewards_last_computed_at IS NULL THEN 0
                ELSE token0_reward_amount + token1_reward_amount
              END
            ) AS distributed,
            SUM(
              CASE
                WHEN crp.end_time <= ci.latest_end_time
                  AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours')
                THEN token0_reward_amount
                ELSE 0
              END
            ) AS daily_rewards_token0,
            SUM(
              CASE
                WHEN crp.end_time <= ci.latest_end_time
                  AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours')
                THEN token1_reward_amount
                ELSE 0
              END
            ) AS daily_rewards_token1,
            SUM(
              CASE
                WHEN crp.end_time <= ci.latest_end_time
                  AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours')
                THEN token0_reward_amount + token1_reward_amount
                ELSE 0
              END
            ) AS daily_rewards,
            SUM(token0_reward_amount + token1_reward_amount) AS scheduled,
            AVG(
              CASE
                WHEN crp.end_time <= ci.latest_end_time
                  AND crp.end_time > (ci.latest_end_time - INTERVAL '24 hours')
                THEN crp.realized_volatility
                ELSE NULL
              END
            ) AS realized_volatility
          FROM incentives.campaign_reward_periods crp
          JOIN campaign_info ci ON crp.campaign_id = ci.campaign_id
          GROUP BY crp.campaign_id, crp.token0, crp.token1
        ),
        depth_per_campaign_pair AS (
          SELECT
            rbt.campaign_id,
            rbt.token0,
            rbt.token1,
            MAX(depth_percent) AS depth_percent,
            SUM(pd.depth0) AS depth0,
            SUM(pd.depth1) AS depth1
          FROM rewards_by_token rbt
          LEFT JOIN LATERAL (
            SELECT
              MAX(depth_percent) AS depth_percent,
              MAX(depth0) AS depth0,
              MAX(depth1) AS depth1
            FROM pool_market_depth_materialized pmd
            JOIN pool_keys pk ON pmd.pool_key_id = pk.pool_key_id
            WHERE
              pmd.depth_percent <= rbt.realized_volatility * 2
              AND pk.token0 = rbt.token0
              AND pk.token1 = rbt.token1
              AND pk.chain_id = COALESCE($1, pk.chain_id)
              AND pk.pool_extension IN (
                SELECT UNNEST(allowed_extensions)
                FROM incentives.campaigns c
                WHERE c.id = rbt.campaign_id
                  AND c.chain_id = COALESCE($1, c.chain_id)
              )
            GROUP BY pk.pool_key_id
          ) AS pd ON TRUE
          GROUP BY rbt.campaign_id, rbt.token0, rbt.token1
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
          FROM rewards_by_token rbt
          JOIN incentives.campaigns c ON rbt.campaign_id = c.id
          LEFT JOIN depth_per_campaign_pair dpcp ON rbt.campaign_id = dpcp.campaign_id
            AND rbt.token0 = dpcp.token0
            AND rbt.token1 = dpcp.token1
          WHERE c.chain_id = COALESCE($1, c.chain_id)
          GROUP BY rbt.campaign_id
        )
        SELECT
          c.slug,
          c.start_time,
          c.end_time,
          c.name,
          c.reward_token,
          (
            CASE
              WHEN CURRENT_TIMESTAMP < c.start_time THEN c.start_time + c.distribution_cadence + INTERVAL '12 hours'
              WHEN c.end_time IS NULL OR CURRENT_TIMESTAMP < c.end_time THEN
                date_bin(
                  c.distribution_cadence,
                  CURRENT_TIMESTAMP + c.distribution_cadence - INTERVAL '12 hours',
                  c.start_time
                ) + INTERVAL '12 hours'
              ELSE NULL
            END
          ) AS next_drop_time,
          c.allowed_extensions::text[] AS allowed_extensions,
          campaign_rewards.rewards
        FROM incentives.campaigns c
        JOIN campaign_rewards ON campaign_rewards.campaign_id = c.id
        WHERE c.chain_id = COALESCE($1, c.chain_id)
    `,
      values: [chainId],
    });
  }

  async listRewardsPeriodsForCampaign(
    slug: string,
    activeAt?: string,
    chainId: bigint | null = null,
  ) {
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
            AND c.chain_id = COALESCE($3, c.chain_id)
      `,
      values: [slug, activeAt ?? null, chainId],
    });
  }

  async listRewardPeriods(activeAt?: string, chainId: bigint | null = null) {
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
            AND c.chain_id = COALESCE($2, c.chain_id)
      `,
      values: [activeAt ?? null, chainId],
    });
  }

  async listComputedRewardsForPosition(
    locker: string,
    salt: string,
    startTime?: string,
    endTime?: string,
    excludeDropped?: boolean,
    chainId: bigint | null = null,
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
            AND c.chain_id = COALESCE($6, c.chain_id)
          GROUP BY c.slug
      `,
      values: [
        locker,
        salt,
        startTime ?? null,
        endTime ?? null,
        excludeDropped ?? false,
        chainId,
      ],
    });
  }

  async listComputedRewardsForAllPositions(
    ownerAddress: string,
    startTime?: string,
    endTime?: string,
    excludeDropped?: boolean,
    chainId: bigint | null = null,
  ) {
    return this.client.query<{
      salt: string;
      slug: string;
      amount: string;
      pending: string;
    }>({
      text: `
          WITH keys AS (SELECT ek.emitter AS locker, token_id::NUMERIC AS salt
                        FROM nonfungible_token_transfers pt1
                                 JOIN event_keys ek ON pt1.event_id = ek.id
                        WHERE to_address = $1
                          AND pt1.chain_id = COALESCE($5, pt1.chain_id)
                          AND ek.chain_id = COALESCE($5, ek.chain_id)
                          AND NOT EXISTS (SELECT 1
                                          FROM nonfungible_token_transfers pt2
                                          WHERE pt2.token_id = pt1.token_id
                                            AND pt2.event_id > pt1.event_id
                                            AND pt2.to_address != 0
                                            AND pt2.chain_id = COALESCE($5, pt2.chain_id)))
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
            AND c.chain_id = COALESCE($5, c.chain_id)
          GROUP BY k.salt, c.slug
      `,
      values: [
        ownerAddress,
        startTime ?? null,
        endTime ?? null,
        excludeDropped ?? false,
        chainId,
      ],
    });
  }

  async listAvailableClaimsForAddress(
    address: string,
    chainId: bigint | null = null,
  ) {
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
                       FROM incentives_funded if
                       WHERE if.chain_id = COALESCE($2, if.chain_id)),

               last_funded_roots AS (SELECT owner, token, root
                                     FROM funded_roots
                                     WHERE if_no = 1),

               funded_drops AS (SELECT fr.owner, fr.token, gd.root, gd.id
                                FROM incentives.generated_drop gd
                                         JOIN last_funded_roots fr ON gd.root = fr.root
                                WHERE gd.chain_id = COALESCE($2, gd.chain_id))

          SELECT (SELECT slug
                  FROM incentives.campaign_reward_periods crp
                           JOIN incentives.campaigns c ON crp.campaign_id = c.id
                  WHERE crp.id IN (SELECT campaign_reward_period_id
                                   FROM incentives.generated_drop_reward_periods gdrp
                                   WHERE gdrp.drop_id = gdp.drop_id)
                     AND c.chain_id = COALESCE($2, c.chain_id)
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
            AND gdp.chain_id = COALESCE($2, gdp.chain_id)
      `,
      values: [address, chainId],
    });
  }
}

export async function createQueries(env: Env) {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? env.PG_CONNECTION_STRING;

  if (!connectionString)
    throw new Error(
      "Env does not have either PG_CONNECTION_STRING or HYPERDRIVE",
    );

  const options = {
    // Limit the connections for the Worker request to 5 due to Workers' limits on concurrent external connections
    max: 1,
    // If you are not using array types in your Postgres schema, disable `fetch_types` to avoid an additional round-trip (unnecessary latency)
    fetch_types: false,
  };

  return new Queries(
    new PostgresQueryClient(postgres(connectionString, options)),
  );
}
