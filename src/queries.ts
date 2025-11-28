import postgres, { type Sql } from "postgres";
import { Env } from "./env";

export type StateFilter = "opened" | "closed";

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

export interface LimitOrderMetadata {
  minted_tx_hash: string;
  minted_timestamp: Date;
  token0: string;
  token1: string;
  tick: number;
  amount: string;
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
  chain_id: bigint;
  token_address: string;
  token_symbol: string;
  token_name: string;
  token_decimals: number;
  logo_url: string;
  visibility_priority: number;
  sort_order: number;
  total_supply: string | null;
  usd_price: string | null;
}

export class Queries {
  private readonly sql: Sql<{ bigint: bigint }>;

  constructor(sql: Sql<{ bigint: bigint }>) {
    this.sql = sql;
  }

  public async listErc20Tokens({
    minVisibilityPriority,
    pageSize,
    afterToken,
    chainId,
    search,
  }: {
    minVisibilityPriority: number;
    pageSize: number;
    afterToken: { address: bigint; chainId: bigint } | null;
    chainId?: bigint | null;
    search?: string;
  }) {
    const afterTokenCondition =
      afterToken === null
        ? this.sql`TRUE`
        : this
            .sql`(chain_id, token_address) > (${afterToken.chainId}, ${afterToken.address.toString()})`;
    const trimmedSearch = search?.trim();
    const searchCondition =
      trimmedSearch && trimmedSearch.length > 0
        ? this
            .sql`(token_symbol ILIKE ${trimmedSearch + "%"} OR token_symbol ILIKE ${"%" + trimmedSearch})`
        : this.sql`TRUE`;

    const chainIdCondition = chainId
      ? this.sql`chain_id = ${chainId}`
      : this.sql`TRUE`;

    const rows = await this.sql<RawErc20TokenRow[]>`
      SELECT 
        chain_id, token_address, token_symbol, token_name, token_decimals,
        logo_url, visibility_priority, sort_order, total_supply, usd_price
      FROM erc20_tokens
      WHERE ${chainIdCondition}
        AND visibility_priority >= ${minVisibilityPriority}
        AND ${afterTokenCondition}
        AND ${searchCondition}
      ORDER BY visibility_priority DESC, chain_id, token_address
      LIMIT ${pageSize}
    `;
    return rows;
  }

  public async getErc20TokenByAddress({
    chainId,
    tokenAddress,
  }: {
    chainId: bigint;
    tokenAddress: bigint;
  }) {
    const rows = await this.sql<RawErc20TokenRow[]>`
      SELECT 
        chain_id,
        token_address,
        token_symbol,
        token_name,
        token_decimals,
        logo_url,
        visibility_priority,
        sort_order,
        total_supply,
        usd_price
      FROM erc20_tokens
      WHERE chain_id = ${chainId}
        AND token_address = ${tokenAddress.toString()};
    `;

    return rows.length > 0 ? rows[0] : null;
  }

  public async getErc20TokensByIds(
    ids: { chainId: bigint; tokenAddress: bigint }[],
  ) {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.sql<RawErc20TokenRow[]>`
      SELECT 
        chain_id,
        token_address,
        token_symbol,
        token_name,
        token_decimals,
        logo_url,
        visibility_priority,
        sort_order,
        total_supply,
        usd_price
      FROM erc20_tokens
      WHERE (chain_id, token_address) IN ${this.sql(
        ids.map(
          ({ chainId, tokenAddress }) =>
            this.sql`(${chainId.toString()}, ${tokenAddress.toString()})`,
        ) as any,
      )}
    `;

    return rows;
  }

  public async getLatestBlock(chainId: bigint) {
    const rows = await this.sql<
      {
        number: string;
        hash: string;
        timestamp: string;
      }[]
    >`
      SELECT block_number AS number,
             block_hash   AS hash,
             block_time   AS timestamp
      FROM blocks
      WHERE chain_id = ${chainId}
      ORDER BY block_number DESC
      LIMIT 1
    `;
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getBlockAtOrAfter(timestamp: string, chainId: bigint) {
    const rows = await this.sql<
      {
        number: string;
        hash: string;
        timestamp: string;
      }[]
    >`
      SELECT
        block_number AS number,
        block_hash   AS hash,
        block_time   AS timestamp
      FROM blocks
      WHERE chain_id = ${chainId}
        AND block_time >= ${timestamp}
      ORDER BY block_time ASC
      LIMIT 1
    `;
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async getBlock(blockNumber: number, chainId: bigint) {
    const rows = await this.sql<
      {
        number: string;
        timestamp: string;
      }[]
    >`
      SELECT block_number AS number,
             block_time   AS timestamp
      FROM blocks
      WHERE chain_id = ${chainId}
        AND block_number = ${blockNumber}
    `;
    if (rows.length !== 1) return null;
    return rows[0];
  }

  public async listAllPoolKeys(chainId: bigint | null) {
    const rows = await this.sql<ListPoolKeysQueryResult[]>`
      SELECT chain_id,
             core_address,
             pool_id,
             token0,
             token1,
             fee,
             tick_spacing,
             pool_extension AS extension
      FROM pool_keys
      WHERE chain_id = COALESCE(${chainId}, chain_id)
    `;
    return rows;
  }

  public async getPositionMetadata(
    chainId: bigint,
    nftAddress: bigint,
    tokenId: bigint,
  ): Promise<PositionMetadata | null> {
    const rows = await this.sql<PositionMetadata[]>`
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
            AND pu.chain_id = ${chainId}
          ORDER BY
            pu.event_id DESC
          LIMIT 1) AS mint_position_update ON TRUE
        JOIN pool_keys pk USING (pool_key_id)
      WHERE
        nft.token_id = ${tokenId.toString()}
        AND from_address = 0
        AND nft.chain_id = ${chainId}
        AND nft.emitter = ${nftAddress.toString()}
      LIMIT 1
    `;

    if (rows.length !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getTwammOrderMetadata(tokenId: bigint, chainId: bigint) {
    const rows = await this.sql<TwammOrderMetadata[]>`
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
                                AND b.chain_id = ${chainId}
      WHERE ou.salt = transfer.token_id
        AND ou.chain_id = ${chainId}
      GROUP BY ou.pool_key_id, ou.start_time, ou.end_time
      ) AS order_data ON TRUE
          JOIN pool_keys ON order_data.pool_key_id = pool_keys.pool_key_id
          AND pool_keys.chain_id = ${chainId}
          JOIN blocks ON transfer.block_number = blocks.block_number AND blocks.chain_id = ${chainId}
      WHERE transfer.token_id = ${tokenId.toString()}
        AND from_address = 0
        AND transfer.chain_id = ${chainId}
    `;
    return rows;
  }

  public async getPositionHistory(
    tokenId: bigint,
    lockerAddress: bigint,
    chainId: bigint,
  ) {
    const rows = await this.sql<
      (
        | {
            type: 0;
            transaction_hash: string;
            timestamp: string;
            block_number: bigint;
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
            block_number: bigint;
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
            block_number: bigint;
            from_address: null;
            to_address: null;
            liquidity_delta: null;
            delta0: string;
            delta1: string;
          }
      )[]
    >`
      WITH transfers AS (
        SELECT nft.transaction_hash,
               b.block_time AS timestamp,
               nft.block_number,
               nft.from_address,
               nft.to_address
        FROM nonfungible_token_transfers AS nft
                 JOIN blocks AS b ON b.block_number = nft.block_number
                                  AND b.chain_id = nft.chain_id
                 LEFT JOIN nft_locker_mappings as nlm ON nlm.nft_address = nft.emitter
                                  AND nlm.chain_id = nft.chain_id
        WHERE nft.token_id = ${tokenId.toString()}
          AND nft.from_address != 0
          AND nft.to_address != 0
          AND nft.chain_id = ${chainId}
          AND (
            nft.emitter = ${lockerAddress.toString()}
            OR nlm.locker = ${lockerAddress.toString()} 
          )
      ),
      updates AS (
        SELECT nft.transaction_hash,
               b.block_time AS timestamp,
               nft.block_number,
               pu.liquidity_delta,
               pu.delta0,
               pu.delta1
        FROM nonfungible_token_transfers AS nft
                 JOIN blocks AS b ON b.block_number = nft.block_number
                                     AND b.chain_id = nft.chain_id
                 JOIN position_updates AS pu ON pu.salt = nft.token_id
                 LEFT JOIN nft_locker_mappings as nlm ON nlm.nft_address = nft.emitter
                                  AND nlm.chain_id = nft.chain_id
        WHERE nft.token_id = ${tokenId.toString()}
          AND nft.from_address = 0
          AND nft.chain_id = ${chainId}
          AND pu.chain_id = ${chainId}
          AND (
            nft.emitter = ${lockerAddress.toString()}
            OR nlm.locker = ${lockerAddress.toString()} 
          )
      ),
      fee_collections AS (
        SELECT nft.transaction_hash,
               b.block_time AS timestamp,
               nft.block_number,
               pfc.delta0,
               pfc.delta1
        FROM nonfungible_token_transfers AS nft
                 JOIN blocks AS b ON b.block_number = nft.block_number
                                     AND b.chain_id = nft.chain_id
                 JOIN position_fees_collected AS pfc ON pfc.salt = nft.token_id
                 LEFT JOIN nft_locker_mappings as nlm ON nlm.nft_address = nft.emitter
                                  AND nlm.chain_id = nft.chain_id
        WHERE nft.token_id = ${tokenId.toString()}
          AND nft.from_address = 0
          AND nft.chain_id = ${chainId}
          AND pfc.chain_id = ${chainId}
          AND (
            nft.emitter = ${lockerAddress.toString()}
            OR nlm.locker = ${lockerAddress.toString()} 
          )
      ),
      all_events AS (
        SELECT 0 AS type,
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
        SELECT 1 AS type,
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
        SELECT 2 AS type,
               transaction_hash,
               timestamp,
               block_number,
               NULL AS from_address,
               NULL AS to_address,
               NULL AS liquidity_delta,
               delta0,
               delta1
        FROM fee_collections
      )
      SELECT *
      FROM all_events
      ORDER BY timestamp DESC
    `;
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
    const rows = await this.sql<
      {
        tick: string;
        net_liquidity_delta_diff: string;
      }[]
    >`
      SELECT tick, SUM(net_liquidity_delta_diff) AS net_liquidity_delta_diff
      FROM per_pool_per_tick_liquidity
              JOIN pool_keys USING (pool_key_id)
      WHERE net_liquidity_delta_diff != 0
        AND token0 = ${token0.toString()}
        AND token1 = ${token1.toString()}
        AND chain_id = ${chainId}
      GROUP BY tick
      ORDER BY tick
    `;
    return rows;
  }

  public getPoolLiquidityGraph(
    chainId: bigint,
    key: {
      coreAddress: bigint;
      token0: bigint;
      token1: bigint;
      fee: bigint;
      tickSpacing: number;
      extension: bigint;
    },
  ) {
    return this.sql<
      {
        tick: string;
        net_liquidity_delta_diff: string;
      }[]
    >`
      SELECT tick, net_liquidity_delta_diff
      FROM per_pool_per_tick_liquidity
      WHERE pool_key_id = (SELECT pool_key_id
                          FROM pool_keys
                          WHERE chain_id = ${chainId}
                            AND core_address = ${key.coreAddress.toString()}
                            AND token0 = ${key.token0.toString()}
                            AND token1 = ${key.token1.toString()}
                            AND fee = ${key.fee.toString()}
                            AND tick_spacing = ${key.tickSpacing}
                            AND pool_extension = ${key.extension.toString()})
      ORDER BY tick
    `;
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
    const rows = await this.sql<
      {
        is_twamm: boolean;
        is_oracle: boolean;
        is_mev_capture: boolean;
      }[]
    >`
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
      WHERE pk.chain_id = ${chainId}
        AND pk.token0 = ${token0.toString()}
        AND pk.token1 = ${token1.toString()}
        AND pk.fee = ${fee.toString()}
        AND pk.tick_spacing = ${tickSpacing}
        AND pk.pool_extension = ${extension.toString()}
      LIMIT 1
    `;

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
    return this.sql<
      {
        type: 0 | 1;

        fee: string;
        tick_spacing: number;
        extension: string;
        core_address: string;
        locker: string;

        timestamp: string;

        transaction_hash: string;

        delta0: string;
        delta1: string;
      }[]
    >`
      WITH earliest_block_time AS (
        SELECT block_time
        FROM swaps
        WHERE chain_id = ${chainId}
          AND block_time >= NOW() - INTERVAL '1 days'
        ORDER BY block_time
        LIMIT 1
      ),
      relevant_pool_keys AS (
        SELECT pool_key_id,
               fee,
               pool_extension AS extension,
               tick_spacing,
               core_address
        FROM pool_keys
        WHERE token0 = ${token0.toString()}
          AND token1 = ${token1.toString()}
          AND chain_id = ${chainId}
      ),
      relevant_swaps AS (
        SELECT 0 AS type,
               relevant_pool_keys.pool_key_id AS pool_key_id,
               relevant_pool_keys.fee,
               relevant_pool_keys.tick_spacing,
               relevant_pool_keys.extension,
               relevant_pool_keys.core_address,
               swaps.block_time AS timestamp,
               transaction_hash,
               event_id,
               locker,
               delta0,
               delta1
        FROM swaps JOIN relevant_pool_keys ON swaps.pool_key_id = relevant_pool_keys.pool_key_id,
             earliest_block_time
        WHERE swaps.block_time >= earliest_block_time.block_time
          AND swaps.chain_id = ${chainId}
      ),
      relevant_updates AS (
        SELECT 1 AS type,
               relevant_pool_keys.pool_key_id AS pool_key_id,
               relevant_pool_keys.fee,
               relevant_pool_keys.tick_spacing,
               relevant_pool_keys.extension,
               relevant_pool_keys.core_address,
               blocks.block_time AS timestamp,
               transaction_hash,
               event_id,
               locker,
               delta0,
               delta1
        FROM position_updates
                 JOIN relevant_pool_keys ON position_updates.pool_key_id = relevant_pool_keys.pool_key_id
                 JOIN blocks ON position_updates.block_number = blocks.block_number
                                AND position_updates.chain_id = blocks.chain_id,
             earliest_block_time
        WHERE blocks.block_time >= earliest_block_time.block_time
          AND position_updates.chain_id = ${chainId}
      ),
      combined AS (
        SELECT *
        FROM relevant_updates
        UNION ALL
        SELECT *
        FROM relevant_swaps
      )
      SELECT core_address,
             delta0,
             delta1,
             extension,
             fee,
             locker,
             tick_spacing,
             timestamp,
             transaction_hash,
             type
      FROM combined
      ORDER BY event_id DESC
      LIMIT ${limit}
    `;
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
      return this.sql<{ token: string; revenue: string }[]>`
        SELECT hrbt.token,
               SUM(revenue) AS revenue
        FROM hourly_revenue_by_token hrbt
                 JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
        WHERE hour >= ${since}
          AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
        GROUP BY hrbt.token
      `;
    }

    return this.sql<{ token: string; revenue: string }[]>`
      SELECT hrbt.token,
             SUM(revenue) AS revenue
      FROM hourly_revenue_by_token hrbt
               JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
      WHERE hrbt.hour >= ${since}
        AND pk.token0 = ${pair.token0.toString()}
        AND pk.token1 = ${pair.token1.toString()}
        AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
      GROUP BY hrbt.token
    `;
  }

  public getTvlByToken(
    chainId: bigint,
    pair?: { token0: bigint; token1: bigint },
  ) {
    const token0 = pair?.token0?.toString() ?? null;
    const token1 = pair?.token1?.toString() ?? null;
    return this.sql<{ token: string; balance: string }[]>`
      WITH summed0 AS (
             SELECT pk.token0 AS token,
                    SUM(ptvl.balance0) AS balance
             FROM pool_tvl ptvl
                      JOIN pool_keys pk USING (pool_key_id)
             WHERE pk.token0 = COALESCE(${token0}, pk.token0)
               AND pk.token1 = COALESCE(${token1}, pk.token1)
               AND pk.chain_id = ${chainId}
             GROUP BY pk.token0
           ),
           summed1 AS (
             SELECT pk.token1 AS token,
                    SUM(ptvl.balance1) AS balance
             FROM pool_tvl ptvl
                      JOIN pool_keys pk USING (pool_key_id)
             WHERE pk.token0 = COALESCE(${token0}, pk.token0)
               AND pk.token1 = COALESCE(${token1}, pk.token1)
               AND pk.chain_id = ${chainId}
             GROUP BY pk.token1
           ),
           all_balances AS (
             SELECT *
             FROM summed0
             UNION ALL
             SELECT *
             FROM summed1
           )
      SELECT token, SUM(balance) AS balance
      FROM all_balances
      GROUP BY token
    `;
  }

  public getTvlDeltaByTokenByDate(
    chainId: bigint,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    const token0 = pair?.token0?.toString() ?? null;
    const token1 = pair?.token1?.toString() ?? null;
    return this.sql<{ token: string; date: string; balance: string }[]>`
      SELECT htd.token,
             DATE_TRUNC('day', hour, 'UTC') AS date,
             SUM(delta)                     AS delta
      FROM hourly_tvl_delta_by_token htd
               JOIN pool_keys pk ON pk.pool_key_id = htd.pool_key_id
      WHERE hour >= ${after}
        AND pk.token0 = COALESCE(${token0}, pk.token0)
        AND pk.token1 = COALESCE(${token1}, pk.token1)
        AND pk.chain_id = ${chainId}
      GROUP BY htd.token, date
    `;
  }

  public async getTwammOrdersByAddress(
    address: bigint,
    state: StateFilter | null,
    chainId: bigint | null,
  ) {
    const includeOpened = state === "opened" || state === null;
    const includeClosed = state === "closed" || state === null;

    return this.sql<
      {
        chain_id: bigint;
        nft_address: string;
        token_id: string;
        sell_token: string;
        buy_token: string;
        start_time: Date;
        end_time: Date;
        fee: string;
        last_collect_proceeds: Date | null;
        total_proceeds_withdrawn: string;
        sale_rate: string;
      }[]
    >`
WITH owned_tokens AS (SELECT *
                      FROM nonfungible_token_orders_view
                      WHERE (current_owner = ${address.toString()})
                         OR ( ${includeClosed} AND current_owner = 0 AND previous_owner = ${address.toString()} ))
SELECT ot.chain_id,
       nft_address,
       token_id,
       sell_token,
       buy_token,
       start_time,
       end_time,
       fee,
       last_collect_proceeds,
       amount_sold,
       total_proceeds_withdrawn,
       sale_rate
FROM owned_tokens AS ot
         JOIN pool_keys USING (pool_key_id)
         LEFT JOIN LATERAL (
    SELECT b.block_time AS last_collect_proceeds
    FROM twamm_proceeds_withdrawals tpw
             JOIN blocks b USING (chain_id, block_number)
    WHERE tpw.pool_key_id = ot.pool_key_id
      AND tpw.locker = ot.locker
      AND tpw.salt = ot.token_id
      AND tpw.start_time = ot.start_time
      AND tpw.end_time = ot.end_time
      AND tpw.is_selling_token1 = ot.is_selling_token1
    ORDER BY tpw.event_id DESC
    LIMIT 1
    ) AS tpw ON TRUE
WHERE (
        (${includeOpened} AND (tpw.last_collect_proceeds IS NULL
          OR tpw.last_collect_proceeds < ot.end_time))
        OR (${includeClosed} AND tpw.last_collect_proceeds IS NOT NULL AND tpw.last_collect_proceeds >= ot.end_time)
      )
  AND ot.chain_id = COALESCE(${chainId}, ot.chain_id)
ORDER BY token_id DESC
    `;
  }

  public async getTwammPoolStateByKey({
    chainId,
    token0,
    token1,
    fee,
  }: {
    chainId: bigint;
    token0: bigint;
    token1: bigint;
    fee?: bigint;
  }) {
    const feeParam = fee?.toString() ?? null;
    return this.sql<
      Pick<
        TwammPoolStateQueryResult,
        "token0_sale_rate" | "token1_sale_rate" | "last_execution_time"
      >[]
    >`
      SELECT token0_sale_rate,
             token1_sale_rate,
             tpsm.last_virtual_execution_time AS last_execution_time
      FROM twamm_pool_states AS tpsm
               JOIN pool_states psm ON psm.pool_key_id = tpsm.pool_key_id
               JOIN pool_keys pk ON tpsm.pool_key_id = pk.pool_key_id
      WHERE pk.chain_id = ${chainId}
        AND pk.token0 = ${token0.toString()}
        AND pk.token1 = ${token1.toString()}
        AND ${feeParam ? this.sql`pk.fee = ${feeParam}` : this.sql`true`}
    `;
  }

  public async getSaleRateDeltasByKey({
    token0,
    token1,
    fee,
    chainId,
  }: {
    chainId: bigint;
    token0: bigint;
    token1: bigint;
    fee?: bigint;
  }) {
    const feeParam = fee?.toString() ?? null;
    return this.sql<
      {
        time: Date;
        net_sale_rate_delta0: string;
        net_sale_rate_delta1: string;
      }[]
    >`
      SELECT time, SUM(net_sale_rate_delta0) AS net_sale_rate_delta0, SUM(net_sale_rate_delta1) AS net_sale_rate_delta1
      FROM twamm_sale_rate_deltas AS tsrdm
               JOIN pool_keys pk USING (pool_key_id)
               JOIN twamm_pool_states tps USING (pool_key_id)
      WHERE pk.chain_id = ${chainId}
        AND pk.token0 = ${token0.toString()}
        AND pk.token1 = ${token1.toString()}
        AND ${feeParam ? this.sql`pk.fee = ${feeParam}` : this.sql`true`}
        AND time > tps.last_virtual_execution_time
      GROUP BY time
      HAVING SUM(net_sale_rate_delta0) <> 0 OR SUM(net_sale_rate_delta1) <> 0
      ORDER BY time
    `;
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
    const rows = await this.sql<
      {
        total: string | null;
        k_volume: string | null;
      }[]
    >`
      SELECT SUM(total) AS total, SUM(k_volume) AS k_volume
      FROM hourly_price_data
      WHERE token0 = ${token0.toString()}
        AND token1 = ${token1.toString()}
        AND hour BETWEEN DATE_TRUNC(
              'hour',
              ${endTime}::timestamptz - (${numHours} * INTERVAL '1 hour'),
              'UTC'
            )
            AND DATE_TRUNC('hour', ${endTime}::timestamptz, 'UTC')
        AND chain_id = COALESCE(${chainId ?? null}, chain_id)
    `;

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

    const rows = await this.sql<
      {
        start: string;
        vwap: number;
        min: number;
        max: number;
        k_volume: string;
      }[]
    >`
      SELECT date_bin(
                 ${intervalSeconds} * INTERVAL '1 sec',
                 swaps.block_time,
                 '2000-01-01 00:00:00'::TIMESTAMP WITHOUT TIME ZONE
               ) AS start,
             SUM(swaps.delta1 * swaps.delta1) /
             SUM(ABS(swaps.delta0 * swaps.delta1)) AS vwap,
             MIN(
               CASE
                 WHEN ABS(swaps.delta0) > ${delta0Threshold.toString()} AND ABS(swaps.delta1) > ${delta1Threshold.toString()}
                   THEN ABS(swaps.delta1 / swaps.delta0)
               END
             ) AS min,
             MAX(
               CASE
                 WHEN ABS(swaps.delta0) > ${delta0Threshold.toString()} AND ABS(swaps.delta1) > ${delta1Threshold.toString()}
                   THEN ABS(swaps.delta1 / swaps.delta0)
               END
             ) AS max,
             SUM(ABS(swaps.delta1 * swaps.delta0)) AS k_volume
      FROM swaps
               JOIN pool_keys ON swaps.pool_key_id = pool_keys.pool_key_id
      WHERE pool_keys.token0 = ${token0.toString()}
        AND pool_keys.token1 = ${token1.toString()}
        AND swaps.block_time BETWEEN ${start} AND ${end}
        AND swaps.delta0 != 0
        AND swaps.delta1 != 0
        AND pool_keys.chain_id = COALESCE(${chainId ?? null}, pool_keys.chain_id)
        AND swaps.chain_id = COALESCE(${chainId ?? null}, swaps.chain_id)
      GROUP BY start
      ORDER BY start
    `;

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
    return this.sql<{ token: string; volume: string }[]>`
      SELECT hvbt.token,
             SUM(volume) AS volume,
             SUM(fees)   AS fees
      FROM hourly_volume_by_token hvbt
               JOIN pool_keys pk ON pk.pool_key_id = hvbt.pool_key_id
      WHERE hour >= ${since}
        AND pk.token0 = COALESCE(${pair?.token0?.toString() ?? null}, pk.token0)
        AND pk.token1 = COALESCE(${pair?.token1?.toString() ?? null}, pk.token1)
        AND pk.chain_id = ${chainId}
      GROUP BY hvbt.token
    `;
  }

  public async getVolumeByTokenByDate(
    chainId: bigint,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    return this.sql<
      {
        token: string;
        date: string;
        volume: string;
        fees: string;
      }[]
    >`
      SELECT hvbt.token,
             DATE_TRUNC('day', hour, 'UTC') AS date,
             SUM(volume)                    AS volume,
             SUM(fees)                      AS fees
      FROM hourly_volume_by_token hvbt
               JOIN pool_keys pk ON pk.pool_key_id = hvbt.pool_key_id
      WHERE hour >= ${after}
        AND pk.token0 = COALESCE(${pair?.token0?.toString() ?? null}, pk.token0)
        AND pk.token1 = COALESCE(${pair?.token1?.toString() ?? null}, pk.token1)
        AND pk.chain_id = ${chainId}
      GROUP BY hvbt.token, date
    `;
  }

  public async getRevenueByTokenByDate(
    chainId: bigint,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    if (!pair) {
      return this.sql<{ token: string; volume: string }[]>`
        SELECT hrbt.token,
               DATE_TRUNC('day', hour, 'UTC') as date,
               SUM(revenue) AS revenue
        FROM hourly_revenue_by_token hrbt
                 JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
        WHERE hour >= ${after}
          AND pk.chain_id = ${chainId}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `;
    }

    return this.sql<{ token: string; volume: string }[]>`
      SELECT token,
             DATE_TRUNC('day', hour, 'UTC') as date,
             SUM(revenue) AS revenue
      FROM hourly_revenue_by_token hrbt
               JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
      WHERE hour >= ${after}
        AND pk.token0 = ${pair.token0.toString()}
        AND pk.token1 = ${pair.token1.toString()}
        AND pk.chain_id = ${chainId}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;
  }

  public async getTopPairs(chainId: bigint, minTvlUsd: number) {
    return this.sql<
      {
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
      }[]
    >`
SELECT pk.token0,
       pk.token1,
       SUM(volume0_24h)                  AS volume0_24h,
       SUM(volume1_24h)                  AS volume1_24h,
       SUM(fees0_24h)                    AS fees0_24h,
       SUM(fees1_24h)                    AS fees1_24h,
       SUM(tvl0_total)                   AS tvl0_total,
       SUM(tvl1_total)                   AS tvl1_total,
       SUM(tvl0_delta_24h)               AS tvl0_delta_24h,
       SUM(tvl1_delta_24h)               AS tvl1_delta_24h,
       COALESCE(SUM(depth0), 0::NUMERIC) AS depth0,
       COALESCE(SUM(depth1), 0::NUMERIC) AS depth1,
       MIN(depth_percent)                AS min_depth_percent
FROM last_24h_pool_stats_materialized l24
         JOIN pool_keys pk USING (pool_key_id)
         JOIN erc20_tokens t0 ON pk.chain_id = t0.chain_id AND pk.token0 = t0.token_address
         JOIN erc20_tokens t1 ON pk.chain_id = t1.chain_id AND pk.token1 = t1.token_address
         LEFT JOIN token_pair_realized_volatility_materialized tprv
                   ON pk.chain_id = tprv.chain_id AND pk.token0 = tprv.token0 AND pk.token1 = tprv.token1
         LEFT JOIN LATERAL (
    SELECT *
    FROM pool_market_depth_materialized pmd
    WHERE pk.pool_key_id = pmd.pool_key_id
      AND GREATEST(tprv.realized_volatility, 0.001) >= pmd.depth_percent
    ORDER BY depth_percent DESC
    LIMIT 1
    ) AS pmd ON TRUE
WHERE pk.chain_id = ${chainId}
  AND t0.visibility_priority >= 0
  AND t1.visibility_priority >= 0
GROUP BY pk.token0, pk.token1, t0.token_decimals, t1.token_decimals
HAVING SUM(tvl0_total / POWER(10::NUMERIC, t0.token_decimals) * COALESCE(t0.usd_price, 0::NUMERIC) +
           tvl1_total / POWER(10::NUMERIC, t1.token_decimals) * COALESCE(t1.usd_price, 0::NUMERIC))
           >= ${minTvlUsd}
    `;
  }

  public async getTopPools(
    chainId: bigint,
    pair: { token0: bigint; token1: bigint },
    minTvlUsd: number,
  ) {
    return this.sql<
      {
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
      }[]
    >`
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
        JOIN pool_keys p USING (pool_key_id)
        JOIN erc20_tokens t0 ON p.chain_id = t0.chain_id AND p.token0 = t0.token_address
        JOIN erc20_tokens t1 ON p.chain_id = t1.chain_id AND p.token1 = t1.token_address
        LEFT JOIN token_pair_realized_volatility_materialized tprv ON p.chain_id = tprv.chain_id AND p.token0 = tprv.token0 AND p.token1 = tprv.token1
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
          LIMIT 1
        ) AS pmd ON TRUE
      WHERE
        p.chain_id = ${chainId}
        AND p.token0 = ${pair.token0.toString()}
        AND p.token1 = ${pair.token1.toString()}
        AND (
          (tvl0_total / POWER(10::numeric, t0.token_decimals)) * COALESCE(t0.usd_price, 0::numeric) +
          (tvl1_total / POWER(10::numeric, t1.token_decimals)) * COALESCE(t1.usd_price, 0::numeric)
        ) >= ${minTvlUsd}
    `;
  }

  public async getPositionsByAddress(
    address: bigint,
    state: StateFilter | null = null,
    chainId: bigint | null = null,
    pagination: { page: number; pageSize: number },
  ) {
    const includeOpened = state === "opened" || state === null;
    const includeClosed = state === "closed" || state === null;

    const addressStr = address.toString();
    const offset = (pagination.page - 1) * pagination.pageSize;

    const rows = await this.sql<
      (PositionMetadata & {
        chain_id: bigint;
        token_id: string;
        liquidity: string;
        nft_address: string;
        positions_address: string;
        total_count: number;
        pool_state_sqrt_ratio: string;
        pool_state_tick: string;
        pool_state_liquidity: string;
        rewards: Record<
          string,
          {
            amount: string;
            pending: string;
          }
        > | null;
      })[]
    >`
WITH base_positions AS (SELECT nfp.chain_id,
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
                               liquidity,
                               pool_key_id,
                               last_transfer_event_id
                        FROM nonfungible_token_positions_view AS nfp
                                 LEFT JOIN nft_locker_mappings nlm USING (chain_id, nft_address)
                                 JOIN pool_keys USING (pool_key_id)
                        WHERE ${chainId ? this.sql`nfp.chain_id = ${chainId}` : this.sql`TRUE`} AND 
                        ${
                          includeOpened
                            ? this
                                .sql`nfp.liquidity != 0 AND current_owner = ${addressStr}`
                            : includeClosed
                              ? this
                                  .sql`nfp.liquidity = 0 AND (previous_owner = ${addressStr} OR current_owner = ${addressStr})`
                              : this.sql`current_owner = ${addressStr}`
                        }),
     total_count AS (SELECT COUNT(*)::INT AS total_count
                     FROM base_positions),
     pp AS (SELECT *
            FROM base_positions
            ORDER BY last_transfer_event_id DESC
            LIMIT ${pagination.pageSize} OFFSET ${offset})
SELECT pp.chain_id,
       pp.nft_address,
       pp.core_address,
       pp.positions_address,
       pp.token_id,
       pp.token0,
       pp.token1,
       pp.fee,
       pp.tick_spacing,
       pp.extension,
       pp.lower_bound,
       pp.upper_bound,
       pp.liquidity,
       total_count.total_count,
       ps.sqrt_ratio AS pool_state_sqrt_ratio,
       ps.tick       AS pool_state_tick,
       ps.liquidity  AS pool_state_liquidity,
       pr.rewards
FROM total_count
         LEFT JOIN pp ON TRUE
         LEFT JOIN pool_states ps ON pp.pool_key_id = ps.pool_key_id
         LEFT JOIN LATERAL (
    SELECT JSONB_OBJECT_AGG(
                   c.slug,
                   JSONB_BUILD_OBJECT(
                           'amount', total_reward_amount::TEXT,
                           'pending', pending_reward_amount::TEXT
                   )
           ) AS rewards
    FROM incentives.computed_rewards_by_position_materialized crbpm
             JOIN incentives.campaigns c ON crbpm.campaign_id = c.id
    WHERE c.chain_id = pp.chain_id
      AND crbpm.locker = pp.positions_address
      AND crbpm.salt = pp.token_id
    ) pr ON TRUE
ORDER BY pp.last_transfer_event_id DESC;
    `;

    const totalCount = rows.length > 0 ? rows[0].total_count : 0;
    return {
      rows,
      totalCount,
    };
  }

  async listCampaigns(chainId: bigint | null = null) {
    return this.sql<
      {
        chain_id: bigint;
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
      }[]
    >`
SELECT
  chain_id,
  slug,
  start_time,
  end_time,
  name,
  reward_token,
  next_drop_time,
  allowed_extensions,
  rewards
FROM incentives.campaign_rewards_overview
WHERE ${chainId ? this.sql`chain_id = ${chainId}` : this.sql`TRUE`}
    `;
  }

  async listComputedRewardsForPosition(
    chainId: bigint,
    locker: string,
    salt: string,
    startTime?: string,
    endTime?: string,
  ) {
    return this.sql<
      {
        slug: string;
        amount: string;
        pending: string;
      }[]
    >`
SELECT c.slug,
       SUM(cr.reward_amount)                                                AS amount,
       SUM(CASE WHEN gdrp.drop_id IS NULL THEN cr.reward_amount ELSE 0 END) AS pending
FROM incentives.campaigns c
         JOIN incentives.campaign_reward_periods crp ON crp.campaign_id = c.id
         JOIN incentives.computed_rewards cr ON cr.campaign_reward_period_id = crp.id
         LEFT JOIN incentives.generated_drop_reward_periods gdrp ON crp.id = gdrp.campaign_reward_period_id
WHERE c.chain_id = ${chainId}
  AND cr.locker = ${locker}
  AND cr.salt = ${salt}
  AND ${startTime ? this.sql`crp.start_time >= ${startTime}::timestamptz` : this.sql`true`}
  AND ${endTime ? this.sql`crp.start_time >= ${endTime}::timestamptz` : this.sql`true`}
GROUP BY c.slug
    `;
  }

  async listAvailableClaimsForAddress(
    address: string,
    chainId: bigint | null = null,
  ) {
    return this.sql<
      {
        slug: string | null;
        chain_id: bigint;
        drop_address: string;
        owner: string;
        token: string;
        root: string;
        index: number;
        address: string;
        amount: string;
        proof: string[];
      }[]
    >`
WITH funded_roots AS (SELECT if.chain_id,
                             if.emitter AS                                                                                   drop_address,
                             if.owner,
                             if.token,
                             if.root,
                             ROW_NUMBER()
                             OVER (PARTITION BY if.chain_id, if.emitter, if.owner, if.token, if.root ORDER BY event_id DESC) if_no
                      FROM incentives_funded if),
     latest_funded_root AS (SELECT chain_id, drop_address, owner, token, root
                            FROM funded_roots
                            WHERE if_no = 1),
     deployed_drops AS (SELECT COALESCE(dac.chain_id, fr.chain_id)    AS chain_id,
                               COALESCE(fr.drop_address, dac.address) AS drop_address,
                               fr.owner,
                               COALESCE(dac.token, fr.token)          AS token,
                               gd.root,
                               gd.id
                        FROM incentives.generated_drop gd
                                 LEFT JOIN latest_funded_root fr ON gd.root = fr.root
                                 LEFT JOIN incentives.deployed_airdrop_contracts dac ON dac.drop_id = gd.id)
SELECT (SELECT slug
        FROM incentives.campaign_reward_periods crp
                 JOIN incentives.campaigns c ON crp.campaign_id = c.id
        WHERE crp.id IN (SELECT campaign_reward_period_id
                         FROM incentives.generated_drop_reward_periods gdrp
                         WHERE gdrp.drop_id = gdp.drop_id)
          AND c.chain_id = fd.chain_id
        LIMIT 1) AS slug,
       chain_id,
       drop_address,
       owner,
       token,
       root,
       gdp.id    AS index,
       address,
       amount,
       (SELECT JSONB_AGG(v::TEXT) FROM UNNEST(proof) AS p(v)) as proof
FROM incentives.generated_drop_proof gdp
         JOIN deployed_drops fd ON gdp.drop_id = fd.id
WHERE address = ${address} AND ${chainId === null ? this.sql`true` : this.sql`fd.chain_id = ${chainId}`}
    `;
  }

  async getProposals(chainId: bigint) {
    return this.sql<
      {
        id: string;
        chain_id: bigint;
        created: number;
        description: string | null;
        calls: { to: string; selector: string; calldata: string[] }[] | null;
        results: string[][] | null;
        executed_tx_hash: string | null;
      }[]
    >`
        SELECT gp.proposal_id as id,
               gp.chain_id,
               gp.proposer                      AS proposer,
               (SELECT description
                FROM governor_proposal_described gpd
                WHERE gpd.proposal_id = gp.proposal_id
                ORDER BY event_id DESC
                LIMIT 1)                        AS description,
               EXTRACT(EPOCH FROM b.block_time)::int4 AS created,
               (SELECT JSONB_AGG(
                               JSONB_BUILD_OBJECT('to', to_address::TEXT, 'selector', selector::TEXT, 'calldata',
                                                  calldata::TEXT[])
                               ORDER BY index)
                FROM governor_proposed_calls gpc
                WHERE gpc.proposal_id = gp.proposal_id)  AS calls,
               (SELECT JSONB_AGG(
                               results::TEXT[]
                               ORDER BY index)
                FROM governor_executed_results ger
                WHERE ger.proposal_id = gp.proposal_id)  AS results,
               (SELECT transaction_hash
                FROM governor_executed ge
                WHERE ge.proposal_id = gp.proposal_id)            AS executed_tx_hash
        FROM governor_proposed gp
                 JOIN blocks b ON gp.block_number = b.block_number
                                  AND gp.chain_id = b.chain_id
        WHERE gp.proposal_id NOT IN (SELECT proposal_id FROM governor_canceled)
                 AND gp.chain_id = ${chainId.toString()}
        ORDER BY b.block_time DESC
    `;
  }

  async getVotesOnProposal({
    proposalId,
    chainId,
  }: {
    proposalId: bigint;
    chainId: bigint;
  }) {
    return this.sql<
      {
        time: number;
        voter: string;
        weight: string;
        yea: boolean;
      }[]
    >`
          SELECT FLOOR(EXTRACT(EPOCH FROM b.block_time))::int4 AS time, voter, weight, yea
          FROM governor_voted gv
                   JOIN blocks b ON gv.block_number = b.block_number
          WHERE gv.proposal_id = ${proposalId.toString()}
                AND gv.chain_id = ${chainId.toString()}
      `;
  }

  async getVotersOnProposal({
    proposalId,
    chainId,
  }: {
    proposalId: bigint;
    chainId: bigint;
  }) {
    return this.sql<
      {
        delegate: string;
        weight: string;
        vote_time: number | null;
        yea: boolean | null;
      }[]
    >`
          SELECT
            pdvwm.delegate,
            pdvwm.voting_weight AS weight,
            gv.yea,
            FLOOR(
              EXTRACT(
                epoch
                FROM
                  b.block_time
              )
            )::int4 AS vote_time
          FROM
            proposal_delegate_voting_weights_materialized pdvwm
            LEFT JOIN governor_voted gv ON pdvwm.proposal_id = gv.proposal_id
            AND pdvwm.delegate = gv.voter
            LEFT JOIN blocks b ON gv.block_number = b.block_number
          WHERE
            pdvwm.proposal_id = ${proposalId.toString()}
            AND pdvwm.chain_id = ${chainId.toString()}
          ORDER BY
            weight DESC
          limit 100;
      `;
  }

  async getTopDelegates({
    pageSize,
    start,
    chainId,
  }: {
    pageSize: number;
    start: number;
    chainId: bigint;
  }) {
    return this.sql<
      {
        delegate: string;
        amount: string;
        yea: number;
        nay: number;
        missed: number;
      }[]
    >`
          WITH
            staker_delegation_changes AS (
              SELECT
                chain_id,
                amount,
                delegate
              FROM
                staker_staked
              WHERE chain_id = ${chainId.toString()}
              UNION ALL
              SELECT
                chain_id,
                - amount AS amount,
                delegate
              FROM
                staker_withdrawn
              WHERE chain_id = ${chainId.toString()}
            ),
            top_delegates AS (
              SELECT
                chain_id,
                delegate,
                SUM(amount) AS amount
              FROM
                staker_delegation_changes
              GROUP BY
                delegate, chain_id
            ),
            ended_proposals AS (
              SELECT
                gp.chain_id,
                gp.proposal_id
              FROM
                governor_proposed gp
                JOIN governor_reconfigured gr ON gr.version = gp.config_version AND gr.chain_id = gp.chain_id
                JOIN blocks b ON gp.block_number = b.block_number AND gp.chain_id = b.chain_id
              WHERE
                gp.chain_id = ${chainId.toString()}
                AND (b.block_time + (gr.voting_period + gr.voting_start_delay) * INTERVAL '1 seconds') < (
                  SELECT
                    block_time
                  FROM
                    blocks b
                  WHERE chain_id = ${chainId.toString()}
                  ORDER BY
                    block_number DESC
                  LIMIT
                    1
                )
            )
          SELECT
            td.delegate,
            amount,
            COUNT(
              CASE
                WHEN gv.yea IS TRUE THEN TRUE
                ELSE NULL
              END
            )::int4 AS yea,
            COUNT(
              CASE
                WHEN gv.yea IS FALSE THEN TRUE
                ELSE NULL
              END
            )::int4 AS nay,
            COUNT(
              CASE
                WHEN gv.yea IS NULL
                AND gc.proposal_id IS NULL
                AND ep.proposal_id IS NOT NULL THEN TRUE
                ELSE NULL
              END
            )::int4 AS missed
          FROM
            top_delegates td
            LEFT JOIN proposal_delegate_voting_weights_materialized pdvwm ON td.delegate = pdvwm.delegate AND td.chain_id = pdvwm.chain_id
            LEFT JOIN ended_proposals ep ON pdvwm.proposal_id = ep.proposal_id
            LEFT JOIN governor_voted gv ON td.delegate = gv.voter
              AND gv.proposal_id = pdvwm.proposal_id
            LEFT JOIN governor_canceled gc ON pdvwm.proposal_id = gc.proposal_id
          GROUP BY
            td.delegate, td.amount
          ORDER BY
            2 DESC
          LIMIT ${pageSize} OFFSET ${start}
      `;
  }

  async getDelegatesStakedTo({
    staker,
    chainId,
  }: {
    staker: bigint;
    chainId: bigint;
  }) {
    return this.sql<{ delegate: string; amount: string }[]>`
          WITH staker_delegation_changes AS (SELECT amount, delegate
                                             FROM staker_staked
                                             WHERE from_address = ${staker.toString()}
                                               AND chain_id = ${chainId.toString()}
                                             UNION ALL
                                             SELECT -amount AS amount, delegate
                                             FROM staker_withdrawn
                                             WHERE from_address = ${staker.toString()}
                                               AND chain_id = ${chainId.toString()}),
               summed AS (SELECT delegate,
                                 SUM(amount) AS amount
                          FROM staker_delegation_changes
                          GROUP BY delegate)
          SELECT delegate, amount
          FROM summed
          WHERE amount != 0
          ORDER BY amount DESC
      `;
  }

  async getAmountDelegatedTo({
    delegate,
    chainId,
  }: {
    delegate: bigint;
    chainId: bigint;
  }) {
    const rows = await this.sql<
      {
        amount_delegated: string;
      }[]
    >`
          SELECT COALESCE((SELECT SUM(amount)
                           FROM staker_staked
                           WHERE delegate = ${delegate.toString()} AND chain_id = ${chainId}), 0::NUMERIC) - COALESCE(
                         (SELECT SUM(amount)
                          FROM staker_withdrawn
                          WHERE delegate = ${delegate.toString()} AND chain_id = ${chainId}), 0::NUMERIC) AS amount_delegated
      `;

    return BigInt(rows[0]?.amount_delegated ?? 0);
  }

  getLimitOrdersByAddress(
    address: bigint,
    state: StateFilter | null,
    chainId: bigint | null,
  ) {
    const includeOpened = state === "opened" || state === null;
    const includeClosed = state === "closed" || state === null;

    return this.sql<
      {
        chain_id: bigint;
        token_id: string;
        token0: string;
        token1: string;
        tick: number;
        liquidity: string;
        amount: string;
        token0_amount_withdrawn: string | null;
        token1_amount_withdrawn: string | null;
      }[]
    >`
          WITH owned_tokens AS (SELECT chain_id, token_id
                      FROM nonfungible_token_transfers pt1
                      WHERE to_address = ${address.toString()}
                        AND chain_id = COALESCE(${chainId?.toString() ?? null}, chain_id)
                        AND NOT EXISTS (SELECT 1
                                          FROM nonfungible_token_transfers pt2
                                          WHERE pt2.token_id = pt1.token_id
                                            AND pt2.event_id > pt1.event_id
                                        )
                    )
          SELECT ot.chain_id,
                 ot.token_id,
                 lo.token0,
                 lo.token1,
                 lo.tick,
                 lo.liquidity,
                 lo.amount,
                 lc.token0_amount_withdrawn,
                 lc.token1_amount_withdrawn
          FROM owned_tokens ot
                   -- select the information for the latest open event for each order
               JOIN LATERAL (
                      SELECT event_id AS open_event_id, token0, token1, tick, liquidity, amount
                      FROM limit_order_placed lop
                      WHERE salt = ot.token_id::NUMERIC
                      ORDER BY event_id DESC
                      LIMIT 1
               ) AS lo ON TRUE
               -- select the latest close event
               LEFT JOIN LATERAL (
                      SELECT event_id AS close_event_id, amount0 AS token0_amount_withdrawn, amount1 AS token1_amount_withdrawn
                      FROM limit_order_closed
                      WHERE salt = ot.token_id::NUMERIC
                      ORDER BY event_id DESC
                      LIMIT 1
               ) AS lc ON TRUE
          WHERE (
            (${includeClosed} AND lc.close_event_id IS NOT NULL)
            OR (${includeOpened} AND (lc.close_event_id IS NULL OR lc.close_event_id < lo.open_event_id))
          )
      `;
  }
}

export async function createQueries(env: Env) {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? env.PG_CONNECTION_STRING;

  if (!connectionString) throw new Error("No postgres configuration");

  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    types: { bigint: postgres.BigInt },
  });

  return new Queries(sql);
}
