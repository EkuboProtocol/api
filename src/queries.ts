import postgres, { type Sql } from "postgres";
import { Env } from "./env";

export type StateFilter = "opened" | "closed";

type PoolKeyFilters = {
  coreAddress?: bigint;
  poolId?: bigint;
};

export interface PositionMetadata {
  minted_tx_hash: string;
  minted_timestamp: Date;
  positions_address: string;
  salt: string;
  lower_bound: string;
  upper_bound: string;
  token0: string;
  token1: string;
  fee: string;
  fee_denominator: string;
  tick_spacing: string | null;
  extension: string;
  stableswap_center_tick: number | null;
  stableswap_amplification: string | null;
}

type PositionEventBaseRow = {
  event_id: bigint;
  block_number: bigint;
  transaction_index: number;
  event_index: number;
  transaction_hash: string;
  timestamp: Date;
  position_id: string;
  nft_address: string;
  positions_address: string;
};

type PositionEventPoolRow = {
  core_address: string;
  pool_id: string;
  token0: string;
  token1: string;
  fee: string;
  fee_denominator: string;
  tick_spacing: number | null;
  pool_extension: string;
  stableswap_center_tick: number | null;
  stableswap_amplification: number | null;
  lower_bound: number;
  upper_bound: number;
};

type PositionLifecycleEventRow<T extends 0 | 1 | 2> = PositionEventBaseRow & {
  type: T;
  token_id: string;
  from_address: string;
  to_address: string;
  core_address: null;
  pool_id: null;
  token0: null;
  token1: null;
  fee: null;
  fee_denominator: null;
  tick_spacing: null;
  pool_extension: null;
  stableswap_center_tick: null;
  stableswap_amplification: null;
  lower_bound: null;
  upper_bound: null;
  liquidity_delta: null;
  delta0: null;
  delta1: null;
};

export type PositionEventRow =
  | PositionLifecycleEventRow<0>
  | PositionLifecycleEventRow<1>
  | PositionLifecycleEventRow<2>
  | (PositionEventBaseRow &
      PositionEventPoolRow & {
        type: 3;
        token_id: null;
        from_address: null;
        to_address: null;
        liquidity_delta: string;
        delta0: string;
        delta1: string;
      })
  | (PositionEventBaseRow &
      PositionEventPoolRow & {
        type: 4;
        token_id: null;
        from_address: null;
        to_address: null;
        liquidity_delta: null;
        delta0: string;
        delta1: string;
      });

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

export interface AuctionNftMetadata {
  minted_tx_hash: string;
  minted_timestamp: Date;
  current_owner: string | null;
  token0: string;
  token1: string;
  config: string;
  token0_symbol: string | null;
  token1_symbol: string | null;
  total_sale_rate: string;
  first_funded_timestamp: Date;
  last_funded_timestamp: Date;
  fund_add_events: number;
  participants_count: number;
  creator_proceeds: string | null;
  proceeds_collect_events: number | null;
  creator_amount: string | null;
  boost_amount: string | null;
  completed_timestamp: Date | null;
  boost_rate: string | null;
  boost_end_time: Date | null;
}

export interface LimitOrderMetadata {
  minted_tx_hash: string;
  minted_timestamp: Date;
  token0: string;
  token1: string;
  tick: number;
  amount: string;
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
  bridge_infos: Record<string, { bridge_address: string }> | null;
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
        logo_url, visibility_priority, sort_order, total_supply, p.value AS usd_price,
        bridge.bridge_infos AS bridge_infos
      FROM erc20_tokens t
      LEFT JOIN erc20_tokens_latest_price p USING (chain_id, token_address)
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(
          dest_chain_id,
          jsonb_build_object('bridge_address', dest_token_address::TEXT)
        ) AS bridge_infos
        FROM erc20_tokens_bridge_relationships br
        WHERE br.source_chain_id = t.chain_id
          AND br.source_token_address = t.token_address
      ) AS bridge ON TRUE
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
        p.value AS usd_price,
        bridge.bridge_infos AS bridge_infos
      FROM erc20_tokens t
      LEFT JOIN erc20_tokens_latest_price AS p USING (chain_id, token_address)
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(
          dest_chain_id,
          jsonb_build_object('bridge_address', dest_token_address::TEXT)
        ) AS bridge_infos
        FROM erc20_tokens_bridge_relationships br
        WHERE br.source_chain_id = t.chain_id
          AND br.source_token_address = t.token_address
      ) AS bridge ON TRUE
      WHERE chain_id = ${chainId.toString()}
        AND token_address = ${tokenAddress.toString()};
    `;

    return rows.length > 0 ? rows[0] : null;
  }

  public async getTokenUsdPriceHistory({
    chainId,
    tokenAddress,
    start,
    end,
    intervalSeconds,
  }: {
    chainId: bigint;
    tokenAddress: bigint;
    start: Date;
    end: Date;
    intervalSeconds: number;
  }) {
    return this.sql<
      {
        start: Date;
        price: number;
      }[]
    >`
      SELECT DISTINCT ON (bucket_start)
        bucket_start AS start,
        value AS price
      FROM (
        SELECT
          date_bin(
            ${intervalSeconds} * INTERVAL '1 second',
            "timestamp",
            TIMESTAMPTZ '2000-01-01 00:00:00+00'
          ) AS bucket_start,
          "timestamp",
          source,
          value
        FROM erc20_tokens_usd_prices
        WHERE chain_id = ${chainId}
          AND token_address = ${tokenAddress.toString()}
          AND "timestamp" >= ${start}
          AND "timestamp" <= ${end}
      ) AS bucketed_prices
      ORDER BY bucket_start, "timestamp" DESC, source DESC
    `;
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
        p.value AS usd_price,
        bridge.bridge_infos AS bridge_infos
      FROM erc20_tokens t
      LEFT JOIN erc20_tokens_latest_price AS p USING (chain_id, token_address)
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(
          dest_chain_id,
          jsonb_build_object('bridge_address', dest_token_address::TEXT)
        ) AS bridge_infos
        FROM erc20_tokens_bridge_relationships br
        WHERE br.source_chain_id = t.chain_id
          AND br.source_token_address = t.token_address
      ) AS bridge ON TRUE
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

  public async getPositionMetadata(
    chainId: bigint,
    nftAddress: bigint,
    tokenId: bigint,
  ): Promise<PositionMetadata | null> {
    const rows = await this.sql<PositionMetadata[]>`
WITH token_mint AS (SELECT nft.chain_id,
                           transaction_hash                             AS minted_tx_hash,
                           nft.emitter                                  AS nft_address,
                           COALESCE(nlm.locker, nft.emitter)            AS locker,
                           nft_token_salt(token_id_transform, token_id) AS salt,
                           block_time                                   AS minted_timestamp
                    FROM nonfungible_token_transfers AS nft
                             JOIN blocks USING (chain_id, block_number)
                             LEFT JOIN nft_locker_mappings nlm
                                       ON nft.chain_id = nlm.chain_id AND nft.emitter = nlm.nft_address
                    WHERE nft.chain_id = ${chainId}
                      AND nft.emitter = ${nftAddress.toString()}
                      AND nft.token_id = ${tokenId.toString()}
                      AND nft.from_address = 0
                    ORDER BY nft.event_id
                    LIMIT 1)
SELECT minted_tx_hash,
       lpu.lower_bound,
       lpu.upper_bound,
       locker            AS positions_address,
       salt,
       minted_timestamp,
       pk.token0,
       pk.token1,
       pk.fee,
       pk.fee_denominator,
       pk.tick_spacing,
       pk.pool_extension AS extension,
       pk.stableswap_center_tick,
       pk.stableswap_amplification
FROM token_mint AS mint
         LEFT JOIN LATERAL (
    SELECT pool_key_id,
           lower_bound,
           upper_bound
    FROM position_updates AS pu
    WHERE pu.chain_id = mint.chain_id
      AND pu.locker = mint.locker
      AND pu.salt = mint.salt
    -- latest one
    ORDER BY pu.event_id DESC
    LIMIT 1) AS lpu
                   ON TRUE
         JOIN pool_keys pk USING (pool_key_id)
    `;

    if (rows.length !== 1) {
      return null;
    }

    return rows[0];
  }

  public async getTwammOrderMetadata(
    tokenId: bigint,
    nftAddress: bigint,
    chainId: bigint,
  ) {
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
        AND transfer.emitter = ${nftAddress.toString()}
    `;
    return rows;
  }

  public async getLimitOrderMetadata(
    tokenId: bigint,
    nftAddress: bigint,
    chainId: bigint,
  ) {
    const rows = await this.sql<LimitOrderMetadata[]>`
          SELECT transaction_hash          AS minted_tx_hash,
                 limit_order_data.token0,
                 limit_order_data.token1,
                 limit_order_data.tick,
                 limit_order_data.amount,
                 b.block_time              AS minted_timestamp
          FROM nonfungible_token_transfers AS nft
               JOIN blocks b USING (block_number, chain_id)
               LEFT JOIN LATERAL (
                    SELECT token0,
                          token1,
                          tick,
                          amount,
                          pool_key_id
                    FROM limit_order_placed AS lop
                    WHERE lop.salt = token_id::NUMERIC
               ) AS limit_order_data ON TRUE
               JOIN pool_keys pk USING (pool_key_id)
          WHERE nft.token_id = ${tokenId.toString()} 
            AND from_address = 0
            AND nft.chain_id = ${chainId}
            AND nft.emitter = ${nftAddress.toString()}
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
            reward_amount: null;
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
            reward_amount: null;
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
            reward_amount: null;
          }
        | {
            type: 3;
            transaction_hash: string;
            timestamp: string;
            block_number: bigint;
            from_address: null;
            to_address: null;
            liquidity_delta: null;
            delta0: null;
            delta1: null;
            reward_amount: string;
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
        SELECT pu.transaction_hash,
               b.block_time AS timestamp,
               pu.block_number,
               pu.liquidity_delta,
               pu.delta0,
               pu.delta1
        FROM position_updates AS pu
                 JOIN blocks AS b ON b.block_number = pu.block_number
                                     AND b.chain_id = pu.chain_id
                 JOIN nonfungible_token_transfers AS nft ON nft.token_id = ${tokenId.toString()}
                                       AND nft.from_address = 0
                                       AND nft.chain_id = pu.chain_id
                 LEFT JOIN nft_locker_mappings AS nlm ON nlm.nft_address = nft.emitter
                                     AND nlm.chain_id = nft.chain_id
        WHERE 
          (pu.salt = nft.token_id
            OR (nlm.token_id_transform IS NOT NULL AND pu.salt = nft_token_salt(nlm.token_id_transform, nft.token_id)))
          AND pu.chain_id = ${chainId}
          AND (
            nft.emitter = ${lockerAddress.toString()}
            OR nlm.locker = ${lockerAddress.toString()}
          )
      ),
      fee_collections AS (
        SELECT pfc.transaction_hash,
               b.block_time AS timestamp,
               pfc.block_number,
               pfc.delta0,
               pfc.delta1
        FROM position_fees_collected AS pfc
                 JOIN blocks AS b ON b.block_number = pfc.block_number
                                     AND b.chain_id = pfc.chain_id
                 JOIN nonfungible_token_transfers AS nft ON nft.token_id = ${tokenId.toString()}
                                       AND nft.from_address = 0
                                       AND nft.chain_id = pfc.chain_id
                 LEFT JOIN nft_locker_mappings AS nlm ON nlm.nft_address = nft.emitter
                                     AND nlm.chain_id = nft.chain_id
        WHERE (pfc.salt = nft.token_id
            OR (nlm.token_id_transform IS NOT NULL AND pfc.salt = nft_token_salt(nlm.token_id_transform, nft.token_id)))

          AND pfc.chain_id = ${chainId}
          AND (
            nft.emitter = ${lockerAddress.toString()}
            OR nlm.locker = ${lockerAddress.toString()}
          )
      ),
      reward_claims AS (
        SELECT vrc.transaction_hash,
               b.block_time AS timestamp,
               vrc.block_number,
               vrc.amount::text AS reward_amount
        FROM ve33_rewards_claimed AS vrc
                 JOIN blocks AS b ON b.block_number = vrc.block_number
                                     AND b.chain_id = vrc.chain_id
                 JOIN nonfungible_token_transfers AS nft ON nft.token_id = ${tokenId.toString()}
                                       AND nft.from_address = 0
                                       AND nft.chain_id = vrc.chain_id
                 LEFT JOIN nft_locker_mappings AS nlm ON nlm.nft_address = nft.emitter
                                     AND nlm.chain_id = nft.chain_id
        WHERE vrc.salt = nft_token_salt(nlm.token_id_transform, nft.token_id)
          AND vrc.owner = COALESCE(nlm.locker, nft.emitter)
          AND vrc.chain_id = ${chainId}
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
               NULL AS delta1,
               NULL AS reward_amount
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
               delta1,
               NULL AS reward_amount
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
               delta1,
               NULL AS reward_amount
        FROM fee_collections
        UNION ALL
        SELECT 3 AS type,
               transaction_hash,
               timestamp,
               block_number,
               NULL AS from_address,
               NULL AS to_address,
               NULL AS liquidity_delta,
               NULL AS delta0,
               NULL AS delta1,
               reward_amount
        FROM reward_claims
      )
      SELECT *
      FROM all_events
      ORDER BY timestamp DESC
    `;
    return rows;
  }

  public async listPositionEvents({
    chainId,
    minEventIdExclusive,
    maxEventIdInclusive,
    limit,
  }: {
    chainId: bigint;
    minEventIdExclusive: bigint;
    maxEventIdInclusive: bigint;
    limit: number;
  }) {
    return this.sql<PositionEventRow[]>`
      WITH transfers AS (
        SELECT CASE
                 WHEN nft.from_address = 0 THEN 0
                 WHEN nft.to_address = 0 THEN 2
                 ELSE 1
               END AS type,
               nft.chain_id,
               nft.event_id,
               nft.block_number,
               nft.transaction_index,
               nft.event_index,
               nft.transaction_hash,
               nft_token_salt(nlm.token_id_transform, nft.token_id) AS position_id,
               nft.emitter AS nft_address,
               COALESCE(nlm.locker, nft.emitter) AS positions_address,
               nft.token_id,
               nft.from_address,
               nft.to_address,
               NULL::BIGINT AS pool_key_id,
               NULL::INT AS lower_bound,
               NULL::INT AS upper_bound,
               NULL::NUMERIC AS liquidity_delta,
               NULL::NUMERIC AS delta0,
               NULL::NUMERIC AS delta1
        FROM nonfungible_token_transfers AS nft
                 LEFT JOIN nft_locker_mappings AS nlm
                           ON nlm.chain_id = nft.chain_id
                             AND nlm.nft_address = nft.emitter
        WHERE nft.chain_id = ${chainId}
          AND nft.event_id > ${minEventIdExclusive}
          AND nft.event_id <= ${maxEventIdInclusive}
          AND (
            nlm.nft_address IS NOT NULL
            -- Legacy Positions contracts emit their own NFTs and need no mapping.
            OR EXISTS (
              SELECT 1
              FROM position_updates AS direct_position
              WHERE direct_position.chain_id = nft.chain_id
                AND direct_position.locker = nft.emitter
                AND direct_position.salt = nft.token_id
            )
          )
        ORDER BY nft.event_id
        LIMIT ${limit}
      ),
      updates AS (
        SELECT 3 AS type,
               pu.chain_id,
               pu.event_id,
               pu.block_number,
               pu.transaction_index,
               pu.event_index,
               pu.transaction_hash,
               pu.salt AS position_id,
               COALESCE(nlm.nft_address, pu.locker) AS nft_address,
               pu.locker AS positions_address,
               NULL::NUMERIC AS token_id,
               NULL::NUMERIC AS from_address,
               NULL::NUMERIC AS to_address,
               pu.pool_key_id,
               pu.lower_bound,
               pu.upper_bound,
               pu.liquidity_delta,
               pu.delta0,
               pu.delta1
        FROM position_updates AS pu
                 LEFT JOIN nft_locker_mappings AS nlm
                           ON nlm.chain_id = pu.chain_id
                             AND nlm.locker = pu.locker
        WHERE pu.chain_id = ${chainId}
          AND pu.event_id > ${minEventIdExclusive}
          AND pu.event_id <= ${maxEventIdInclusive}
          AND (
            nlm.locker IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM nonfungible_token_transfers AS direct_mint
              WHERE direct_mint.chain_id = pu.chain_id
                AND direct_mint.emitter = pu.locker
                AND direct_mint.token_id = pu.salt
                AND direct_mint.from_address = 0
            )
          )
        ORDER BY pu.event_id
        LIMIT ${limit}
      ),
      fee_collections AS (
        SELECT 4 AS type,
               pfc.chain_id,
               pfc.event_id,
               pfc.block_number,
               pfc.transaction_index,
               pfc.event_index,
               pfc.transaction_hash,
               pfc.salt AS position_id,
               COALESCE(nlm.nft_address, pfc.locker) AS nft_address,
               pfc.locker AS positions_address,
               NULL::NUMERIC AS token_id,
               NULL::NUMERIC AS from_address,
               NULL::NUMERIC AS to_address,
               pfc.pool_key_id,
               pfc.lower_bound,
               pfc.upper_bound,
               NULL::NUMERIC AS liquidity_delta,
               pfc.delta0,
               pfc.delta1
        FROM position_fees_collected AS pfc
                 LEFT JOIN nft_locker_mappings AS nlm
                           ON nlm.chain_id = pfc.chain_id
                             AND nlm.locker = pfc.locker
        WHERE pfc.chain_id = ${chainId}
          AND pfc.event_id > ${minEventIdExclusive}
          AND pfc.event_id <= ${maxEventIdInclusive}
          AND (
            nlm.locker IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM nonfungible_token_transfers AS direct_mint
              WHERE direct_mint.chain_id = pfc.chain_id
                AND direct_mint.emitter = pfc.locker
                AND direct_mint.token_id = pfc.salt
                AND direct_mint.from_address = 0
            )
          )
        ORDER BY pfc.event_id
        LIMIT ${limit}
      ),
      page AS (
        -- No source can contribute a row after its first limited rows to the
        -- limited prefix of the globally ordered result.
        SELECT * FROM transfers
        UNION ALL
        SELECT * FROM updates
        UNION ALL
        SELECT * FROM fee_collections
        ORDER BY event_id
        LIMIT ${limit}
      )
      SELECT page.type,
             page.event_id,
             page.block_number,
             page.transaction_index,
             page.event_index,
             page.transaction_hash,
             blocks.block_time AS timestamp,
             page.position_id,
             page.nft_address,
             page.positions_address,
             page.token_id,
             page.from_address,
             page.to_address,
             pool_keys.core_address,
             pool_keys.pool_id,
             pool_keys.token0,
             pool_keys.token1,
             pool_keys.fee,
             pool_keys.fee_denominator,
             pool_keys.tick_spacing,
             pool_keys.pool_extension,
             pool_keys.stableswap_center_tick,
             pool_keys.stableswap_amplification,
             page.lower_bound,
             page.upper_bound,
             page.liquidity_delta,
             page.delta0,
             page.delta1
      FROM page
               JOIN blocks USING (chain_id, block_number)
               LEFT JOIN pool_keys USING (pool_key_id)
      ORDER BY page.event_id
    `;
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
      poolId: bigint;
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
                            AND pool_id = ${key.poolId.toString()})
      ORDER BY tick
    `;
  }

  public async getPoolKeyByCoreAndId(
    chainId: bigint,
    coreAddress: bigint,
    poolId: bigint,
  ) {
    return this.sql<
      {
        pool_key_id: bigint;
        token0: string;
        token1: string;
        fee: string;
        tick_spacing: number | null;
        extension: string;
        stableswap_center_tick: string | null;
        stableswap_amplification: string | null;
      }[]
    >`
      SELECT
        pool_key_id,
        token0,
        token1,
        fee,
        tick_spacing,
        pool_extension AS extension,
        stableswap_center_tick,
        stableswap_amplification
      FROM pool_keys
      WHERE chain_id = ${chainId}
        AND core_address = ${coreAddress.toString()}
        AND pool_id = ${poolId.toString()}
      LIMIT 1
    `;
  }

  public async getPoolPriceSeed(poolKeyId: bigint, beforeOrAt: Date) {
    const rows = await this.sql<
      {
        block_time: Date;
        sqrt_ratio_after: string;
      }[]
    >`
      SELECT
        block_time,
        sqrt_ratio_after
      FROM swaps
      WHERE pool_key_id = ${poolKeyId}
        AND block_time <= ${beforeOrAt}
      ORDER BY block_time DESC, event_id DESC
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  public async getPoolPriceHistoryCandles({
    poolKeyId,
    start,
    end,
    intervalSeconds,
  }: {
    poolKeyId: bigint;
    start: Date;
    end: Date;
    intervalSeconds: number;
  }) {
    return this.sql<
      {
        start: Date;
        open_sqrt_ratio: string;
        high_sqrt_ratio: string;
        low_sqrt_ratio: string;
        close_sqrt_ratio: string;
      }[]
    >`
      WITH bucketed_swaps AS (
        SELECT
          date_bin(
            ${intervalSeconds} * INTERVAL '1 sec',
            block_time,
            '2000-01-01 00:00:00'::TIMESTAMP WITHOUT TIME ZONE
          ) AS start,
          block_time,
          event_id,
          sqrt_ratio_after
        FROM swaps
        WHERE pool_key_id = ${poolKeyId}
          AND block_time BETWEEN ${start} AND ${end}
      )
      SELECT
        start,
        (ARRAY_AGG(sqrt_ratio_after ORDER BY block_time ASC, event_id ASC))[1] AS open_sqrt_ratio,
        MAX(sqrt_ratio_after) AS high_sqrt_ratio,
        MIN(sqrt_ratio_after) AS low_sqrt_ratio,
        (ARRAY_AGG(sqrt_ratio_after ORDER BY block_time DESC, event_id DESC))[1] AS close_sqrt_ratio
      FROM bucketed_swaps
      GROUP BY start
      ORDER BY start
    `;
  }

  public async getPoolTicksById(poolKeyId: bigint) {
    return this.sql<
      {
        tick: number;
        liquidity_delta: string;
      }[]
    >`
      SELECT
        tick,
        net_liquidity_delta_diff AS liquidity_delta
      FROM per_pool_per_tick_liquidity
      WHERE pool_key_id = ${poolKeyId}
        AND net_liquidity_delta_diff <> 0
      ORDER BY tick ASC
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
    tickSpacing: number | null;
    extension: bigint;
  }): Promise<{
    is_twamm: boolean;
    is_oracle: boolean;
    is_mev_capture: boolean;
    is_boosted_fees: boolean;
    is_ve33: boolean;
  } | null> {
    const tickSpacingCondition =
      tickSpacing === null
        ? this.sql`pk.tick_spacing IS NULL`
        : this.sql`pk.tick_spacing = ${tickSpacing}`;

    const rows = await this.sql<
      {
        is_twamm: boolean;
        is_oracle: boolean;
        is_mev_capture: boolean;
        is_boosted_fees: boolean;
        is_ve33: boolean;
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
        ) AS is_mev_capture,
        EXISTS (
          SELECT 1
          FROM boosted_fees_donated
          WHERE pool_key_id = pk.pool_key_id
        ) AS is_boosted_fees,
        EXISTS (
          SELECT 1
          FROM ve33_pool_states
          WHERE pool_key_id = pk.pool_key_id
        ) AS is_ve33
      FROM pool_keys pk
      WHERE pk.chain_id = ${chainId}
        AND pk.token0 = ${token0.toString()}
        AND pk.token1 = ${token1.toString()}
        AND pk.fee = ${fee.toString()}
        AND ${tickSpacingCondition}
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
    tickSpacing,
    fee,
    extension,
    amplification,
    centerTick,
    poolKeyFilters,
  }: {
    token0: bigint;
    token1: bigint;
    limit: number;
    chainId: bigint;
    tickSpacing?: number;
    fee?: bigint;
    extension?: bigint;
    amplification?: number;
    centerTick?: number;
    poolKeyFilters?: PoolKeyFilters;
  }) {
    const tickSpacingCondition =
      tickSpacing === undefined
        ? this.sql`TRUE`
        : tickSpacing === 0
          ? this.sql`pk.tick_spacing IS NULL`
          : this.sql`pk.tick_spacing = ${tickSpacing}`;
    const feeParam = fee?.toString() ?? null;
    const feeCondition = feeParam
      ? this.sql`pk.fee = ${feeParam}`
      : this.sql`TRUE`;
    const extensionParam = extension?.toString() ?? null;
    const extensionCondition = extensionParam
      ? this.sql`pk.pool_extension = ${extensionParam}`
      : this.sql`TRUE`;
    const coreAddressParam = poolKeyFilters?.coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolKeyFilters?.poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;
    const amplificationCondition =
      amplification === undefined
        ? this.sql`TRUE`
        : this.sql`pk.stableswap_amplification = ${amplification}`;
    const centerTickCondition =
      centerTick === undefined
        ? this.sql`TRUE`
        : this.sql`pk.stableswap_center_tick = ${centerTick}`;

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
WITH last_block AS (SELECT block_time
                    FROM blocks
                    WHERE chain_id = ${chainId}
                    ORDER BY block_number DESC
                    LIMIT 1),
     minimum_event_from_day AS (SELECT compute_event_id(
                                               (SELECT block_number
                                                FROM blocks
                                                WHERE chain_id = ${chainId}
                                                  AND block_time >= (SELECT block_time FROM last_block) - INTERVAL '1 day'
                                                ORDER BY block_time, block_number
                                                LIMIT 1),
                                               0, 0
                                       ) AS min_event_id),
     relevant_pool_keys AS MATERIALIZED (SELECT pool_key_id,
                                                core_address,
                                                pool_extension,
                                                fee,
                                                tick_spacing
                                         FROM pool_keys pk
                                         WHERE chain_id = ${chainId}
                                           AND token0 = ${token0.toString()}
                                           AND token1 = ${token1.toString()}
                                           AND ${tickSpacingCondition}
                                           AND ${feeCondition}
                                           AND ${extensionCondition}
                                           AND ${coreAddressCondition}
                                           AND ${poolIdCondition}
                                           AND ${amplificationCondition}
                                           AND ${centerTickCondition}),
     -- A row outside a pool/type partition's newest N cannot be in the global newest N.
     recent_events AS (SELECT rpk.core_address,
                              rpk.pool_extension,
                              rpk.fee,
                              rpk.tick_spacing,
                              s.chain_id,
                              s.event_id,
                              s.block_number,
                              s.transaction_hash,
                              s.delta0,
                              s.delta1,
                              s.locker,
                              0 AS event_type
                       FROM relevant_pool_keys rpk
                                CROSS JOIN LATERAL (
                           SELECT chain_id,
                                  event_id,
                                  block_number,
                                  transaction_hash,
                                  delta0,
                                  delta1,
                                  locker
                           FROM swaps s
                           WHERE s.chain_id = ${chainId}
                             AND s.pool_key_id = rpk.pool_key_id
                             AND s.event_id >= (SELECT min_event_id FROM minimum_event_from_day)
                           ORDER BY s.event_id DESC
                           LIMIT ${limit}
                           ) s

                       UNION ALL

                       SELECT rpk.core_address,
                              rpk.pool_extension,
                              rpk.fee,
                              rpk.tick_spacing,
                              pu.chain_id,
                              pu.event_id,
                              pu.block_number,
                              pu.transaction_hash,
                              pu.delta0,
                              pu.delta1,
                              pu.locker,
                              1 AS event_type
                       FROM relevant_pool_keys rpk
                                CROSS JOIN LATERAL (
                           SELECT chain_id,
                                  event_id,
                                  block_number,
                                  transaction_hash,
                                  delta0,
                                  delta1,
                                  locker
                           FROM position_updates pu
                           WHERE pu.chain_id = ${chainId}
                             AND pu.pool_key_id = rpk.pool_key_id
                             AND pu.event_id >= (SELECT min_event_id FROM minimum_event_from_day)
                           ORDER BY pu.event_id DESC
                           LIMIT ${limit}
                           ) pu
                       ORDER BY event_id DESC
                       LIMIT ${limit})
SELECT core_address,
       delta0,
       delta1,
       pool_extension AS "extension",
       fee,
       locker,
       tick_spacing,
       block_time     AS timestamp,
       transaction_hash,
       event_type     AS type
FROM recent_events
         JOIN blocks USING (chain_id, block_number)
ORDER BY event_id DESC
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
      return this.sql<{ token: string; revenue: string; chain_id: bigint }[]>`
        SELECT pk.chain_id,
               hrbt.token,
               SUM(revenue) AS revenue
        FROM hourly_revenue_by_token hrbt
                 JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
        WHERE hour >= ${since}
          AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
        GROUP BY hrbt.token, pk.chain_id
      `;
    }

    return this.sql<{ token: string; revenue: string; chain_id: bigint }[]>`
      SELECT pk.chain_id,
             hrbt.token,
             SUM(revenue) AS revenue
      FROM hourly_revenue_by_token hrbt
               JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
      WHERE hrbt.hour >= ${since}
        AND pk.token0 = ${pair.token0.toString()}
        AND pk.token1 = ${pair.token1.toString()}
        AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
      GROUP BY hrbt.token, pk.chain_id
    `;
  }

  public getTvlByToken(
    chainId: bigint | null,
    pair?: { token0: bigint; token1: bigint },
    poolKeyFilters?: PoolKeyFilters,
  ) {
    const token0 = pair?.token0?.toString() ?? null;
    const token1 = pair?.token1?.toString() ?? null;
    const coreAddressParam = poolKeyFilters?.coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolKeyFilters?.poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;
    return this.sql<{ chain_id: bigint; token: string; balance: string }[]>`
      WITH summed0 AS (
             SELECT pk.chain_id,
                    pk.token0 AS token,
                    SUM(ptvl.balance0) AS balance
             FROM pool_tvl ptvl
                      JOIN pool_keys pk USING (pool_key_id)
             WHERE pk.token0 = COALESCE(${token0}, pk.token0)
               AND pk.token1 = COALESCE(${token1}, pk.token1)
               AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
               AND ${coreAddressCondition}
               AND ${poolIdCondition}
             GROUP BY pk.token0, pk.chain_id
           ),
           summed1 AS (
             SELECT pk.chain_id,
                    pk.token1 AS token,
                    SUM(ptvl.balance1) AS balance
             FROM pool_tvl ptvl
                      JOIN pool_keys pk USING (pool_key_id)
             WHERE pk.token0 = COALESCE(${token0}, pk.token0)
               AND pk.token1 = COALESCE(${token1}, pk.token1)
               AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
               AND ${coreAddressCondition}
               AND ${poolIdCondition}
             GROUP BY pk.token1, pk.chain_id
           ),
           all_balances AS (
             SELECT *
             FROM summed0
             UNION ALL
             SELECT *
             FROM summed1
           )
      SELECT chain_id, token, SUM(balance) AS balance
      FROM all_balances
      GROUP BY token, chain_id
    `;
  }

  public getTvlDeltaByTokenByDate(
    chainId: bigint | null,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
    poolKeyFilters?: PoolKeyFilters,
  ) {
    const token0 = pair?.token0?.toString() ?? null;
    const token1 = pair?.token1?.toString() ?? null;
    const coreAddressParam = poolKeyFilters?.coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolKeyFilters?.poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;
    return this.sql<
      { token: string; date: string; delta: string; chain_id: bigint }[]
    >`
      SELECT pk.chain_id,
             htd.token,
             DATE_TRUNC('day', hour, 'UTC') AS date,
             SUM(delta)                     AS delta
      FROM hourly_tvl_delta_by_token htd
               JOIN pool_keys pk ON pk.pool_key_id = htd.pool_key_id
      WHERE hour >= ${after}
        AND pk.token0 = COALESCE(${token0}, pk.token0)
        AND pk.token1 = COALESCE(${token1}, pk.token1)
        AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
      GROUP BY htd.token, pk.chain_id, date
    `;
  }

  public async getTwammOrdersByAddress(
    addresses: bigint[],
    state: StateFilter | null,
    chainId: bigint | null,
    pagination: { page: number; pageSize: number },
  ) {
    const includeOpened = state === "opened" || state === null;
    const includeClosed = state === "closed" || state === null;
    const uniqueAddresses = Array.from(
      new Set(addresses.map((address) => address.toString())),
    );
    if (uniqueAddresses.length === 0) {
      return { rows: [], totalCount: 0 };
    }
    const offset = (pagination.page - 1) * pagination.pageSize;

    const rows = await this.sql<
      {
        chain_id: bigint;
        nft_address: string;
        token_id: string;
        total_count: number;
        orders: {
          sell_token: string;
          buy_token: string;
          fee: string;
          start_time: string;
          end_time: string;
          total_proceeds_withdrawn: string;
          total_amount_sold: string;
          sale_rate: string;
          last_collect_proceeds: string | null;
        }[];
      }[]
    >`
WITH owned_tokens AS (
       SELECT *
       FROM nonfungible_token_orders_view
       WHERE current_owner IN ${this.sql(uniqueAddresses)}
          OR (${includeClosed} AND current_owner = 0 AND previous_owner IN ${this.sql(uniqueAddresses)})
     ),
     token_orders AS (
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
              sale_rate,
              tpw.last_collect_proceeds IS NOT NULL
                AND (
                  ot.sale_rate = 0
                  OR tpw.last_collect_proceeds >= ot.end_time
                ) AS is_closed
       FROM owned_tokens AS ot
                JOIN pool_keys pk USING (pool_key_id)
                LEFT JOIN LATERAL (
                  SELECT b.block_time AS last_collect_proceeds
                  FROM twamm_proceeds_withdrawals tpw
                           JOIN blocks b USING (chain_id, block_number)
                  WHERE tpw.pool_key_id = ot.pool_key_id
                    AND tpw.locker = ot.locker
                    AND tpw.salt = ot.salt
                    AND tpw.start_time = ot.start_time
                    AND tpw.end_time = ot.end_time
                    AND tpw.is_selling_token1 = ot.is_selling_token1
                  ORDER BY tpw.event_id DESC
                  LIMIT 1
                ) AS tpw ON TRUE
       WHERE ot.chain_id = COALESCE(${chainId}, ot.chain_id)
     ),
     grouped_orders AS (
       SELECT chain_id,
              nft_address,
              token_id,
              BOOL_OR(NOT is_closed)             AS has_open_order,
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'sell_token', sell_token::TEXT,
                  'buy_token', buy_token::TEXT,
                  'fee', fee::TEXT,
                  'start_time', start_time,
                  'end_time', end_time,
                  'total_proceeds_withdrawn', total_proceeds_withdrawn::TEXT,
                  'total_amount_sold', amount_sold::TEXT,
                  'sale_rate', sale_rate::TEXT,
                  'last_collect_proceeds', last_collect_proceeds::TEXT
               ) ORDER BY end_time
              ) AS orders
       FROM token_orders
       GROUP BY chain_id, nft_address, token_id
     ),
     filtered_orders AS (
       SELECT *
       FROM grouped_orders
       WHERE (
               (${includeOpened} AND has_open_order)
               OR (${includeClosed} AND NOT has_open_order)
             )
     ),
     total_count AS (SELECT COUNT(*)::INT AS total_count FROM filtered_orders),
     paged_orders AS (
       SELECT *
       FROM filtered_orders
       ORDER BY token_id DESC
       LIMIT ${pagination.pageSize} OFFSET ${offset}
     )
SELECT po.chain_id,
       po.nft_address,
       po.token_id,
       po.orders,
       total_count.total_count
FROM paged_orders po
         CROSS JOIN total_count
ORDER BY po.token_id DESC
    `;

    const totalCount = rows[0]?.total_count ?? 0;
    return {
      rows,
      totalCount,
    };
  }

  public async getTwammPoolStateByKey({
    chainId,
    coreAddress,
    token0,
    token1,
    fee,
    poolId,
  }: {
    chainId: bigint;
    coreAddress?: bigint;
    poolId?: bigint;
    token0?: bigint;
    token1?: bigint;
    fee?: bigint;
  }) {
    const coreAddressParam = coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;

    const feeParam = fee?.toString() ?? null;
    const token0Condition =
      token0 !== undefined
        ? this.sql`pk.token0 = ${token0.toString()}`
        : this.sql`TRUE`;
    const token1Condition =
      token1 !== undefined
        ? this.sql`pk.token1 = ${token1.toString()}`
        : this.sql`TRUE`;
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
        AND ${token0Condition}
        AND ${token1Condition}
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
        AND ${feeParam ? this.sql`pk.fee = ${feeParam}` : this.sql`true`}
    `;
  }

  public async getSaleRateDeltasByKey({
    token0,
    token1,
    fee,
    chainId,
    coreAddress,
    poolId,
  }: {
    chainId: bigint;
    coreAddress?: bigint;
    poolId?: bigint;
    token0?: bigint;
    token1?: bigint;
    fee?: bigint;
  }) {
    const coreAddressParam = coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;

    const feeParam = fee?.toString() ?? null;
    const token0Condition =
      token0 !== undefined
        ? this.sql`pk.token0 = ${token0.toString()}`
        : this.sql`TRUE`;
    const token1Condition =
      token1 !== undefined
        ? this.sql`pk.token1 = ${token1.toString()}`
        : this.sql`TRUE`;
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
        AND ${token0Condition}
        AND ${token1Condition}
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
        AND ${feeParam ? this.sql`pk.fee = ${feeParam}` : this.sql`true`}
        AND time > tps.last_virtual_execution_time
      GROUP BY time
      HAVING SUM(net_sale_rate_delta0) <> 0 OR SUM(net_sale_rate_delta1) <> 0
      ORDER BY time
    `;
  }

  public async getPoolTwammState(poolKeyId: bigint) {
    const rows = await this.sql<
      {
        sqrt_ratio: string;
        tick: number;
        liquidity: string;
        fee: string;
        token0_sale_rate: string;
        token1_sale_rate: string;
        last_execution_time: Date;
      }[]
    >`
      SELECT
        ps.sqrt_ratio,
        ps.tick,
        ps.liquidity,
        pk.fee,
        tps.token0_sale_rate,
        tps.token1_sale_rate,
        tps.last_virtual_execution_time AS last_execution_time
      FROM twamm_pool_states tps
             JOIN pool_states ps USING (pool_key_id)
             JOIN pool_keys pk USING (pool_key_id)
      WHERE tps.pool_key_id = ${poolKeyId}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  public async getTwammSaleRateDeltas({
    poolKeyId,
    after,
    until,
  }: {
    poolKeyId: bigint;
    after: Date;
    until: Date;
  }) {
    return this.sql<
      {
        time: Date;
        net_sale_rate_delta0: string;
        net_sale_rate_delta1: string;
      }[]
    >`
      SELECT
        time,
        net_sale_rate_delta0,
        net_sale_rate_delta1
      FROM twamm_sale_rate_deltas
      WHERE pool_key_id = ${poolKeyId}
        AND time > ${after}
        AND time <= ${until}
      ORDER BY time ASC
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

  public getTotalVolume({
    chainId,
    since,
    pair,
    minVolumeUsd,
    poolKeyFilters,
  }: {
    chainId?: bigint | null;
    since?: Date;
    pair?: { chainId: bigint; token0: bigint; token1: bigint };
    minVolumeUsd?: number;
    poolKeyFilters?: PoolKeyFilters;
  }) {
    const coreAddressParam = poolKeyFilters?.coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolKeyFilters?.poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;

    return this.sql<{ token: string; chain_id: bigint; volume: string }[]>`
      SELECT pk.chain_id,
             hvbt.token,
             SUM(volume) AS volume,
             SUM(fees)   AS fees
      FROM hourly_volume_by_token hvbt
            JOIN pool_keys pk USING (pool_key_id)
            JOIN erc20_tokens t ON t.chain_id = pk.chain_id AND t.token_address = hvbt.token
            JOIN erc20_tokens_latest_price tp ON tp.chain_id = t.chain_id AND tp.token_address = t.token_address
      WHERE ${since ? this.sql`hour >= ${since}` : this.sql`true`}
        AND ${
          pair
            ? this
                .sql`pk.chain_id = ${pair.chainId} AND pk.token0 = ${pair.token0.toString()} AND pk.token1 = ${pair.token1.toString()}`
            : this.sql`true`
        }
        AND t.visibility_priority >= 0
        AND ${chainId ? this.sql`pk.chain_id = ${chainId}` : this.sql`true`}
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
      GROUP BY pk.chain_id, hvbt.token
      ${minVolumeUsd ? this.sql`HAVING SUM(volume * tp.value / pow(10::float, t.token_decimals)) > ${minVolumeUsd}` : this.sql``}
    `;
  }

  public async getVolumeByTokenByDate(
    chainId: bigint | null,
    after: Date,
    pair?: { chainId: bigint; token0: bigint; token1: bigint },
    minVolumeUsd?: number,
    poolKeyFilters?: PoolKeyFilters,
  ) {
    const coreAddressParam = poolKeyFilters?.coreAddress?.toString() ?? null;
    const coreAddressCondition = coreAddressParam
      ? this.sql`pk.core_address = ${coreAddressParam}`
      : this.sql`TRUE`;
    const poolIdParam = poolKeyFilters?.poolId?.toString() ?? null;
    const poolIdCondition = poolIdParam
      ? this.sql`pk.pool_id = ${poolIdParam}`
      : this.sql`TRUE`;
    return this.sql<
      {
        chain_id: bigint;
        token: string;
        date: string;
        volume: string;
        fees: string;
      }[]
    >`
      SELECT pk.chain_id,
             hvbt.token,
             DATE_TRUNC('day', hour, 'UTC') AS date,
             SUM(volume)                    AS volume,
             SUM(fees)                      AS fees
      FROM hourly_volume_by_token hvbt
            JOIN pool_keys pk USING (pool_key_id)
            JOIN erc20_tokens t ON pk.chain_id = t.chain_id AND hvbt.token = t.token_address
            JOIN erc20_tokens_latest_price tp ON tp.chain_id = t.chain_id AND tp.token_address = t.token_address
      WHERE hour >= ${after}
        AND ${chainId ? this.sql`pk.chain_id = ${chainId}` : this.sql`true`}
        AND ${
          pair
            ? this
                .sql`pk.chain_id = ${pair.chainId} AND pk.token0 = ${pair.token0.toString()} AND pk.token1 = ${pair.token1.toString()}`
            : this.sql`true`
        }
        AND visibility_priority >= 0
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
      GROUP BY hvbt.token, date, pk.chain_id
      ${minVolumeUsd ? this.sql`HAVING SUM(volume * tp.value / pow(10::float, t.token_decimals)) > ${minVolumeUsd}` : this.sql``}
    `;
  }

  public async getRevenueByTokenByDate(
    chainId: bigint | null,
    after: Date,
    pair?: { token0: bigint; token1: bigint },
  ) {
    if (!pair) {
      return this.sql<{ token: string; volume: string; chain_id: bigint }[]>`
        SELECT pk.chain_id,
               hrbt.token,
               DATE_TRUNC('day', hour, 'UTC') as date,
               SUM(revenue) AS revenue
        FROM hourly_revenue_by_token hrbt
                 JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
        WHERE hour >= ${after}
          AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
      `;
    }

    return this.sql<{ token: string; volume: string; chain_id: bigint }[]>`
      SELECT pk.chain_id,
             token,
             DATE_TRUNC('day', hour, 'UTC') as date,
             SUM(revenue) AS revenue
      FROM hourly_revenue_by_token hrbt
               JOIN pool_keys pk ON pk.pool_key_id = hrbt.pool_key_id
      WHERE hour >= ${after}
        AND pk.token0 = ${pair.token0.toString()}
        AND pk.token1 = ${pair.token1.toString()}
        AND pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `;
  }

  public async getTopPairs(chainId: bigint | null, minTvlUsd: number) {
    return this.sql<
      {
        chain_id: bigint;
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
SELECT
       pk.chain_id,
       pk.token0,
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
         LEFT JOIN erc20_tokens_latest_price t0p ON t0p.chain_id = t0.chain_id AND t0p.token_address = t0.token_address
         JOIN erc20_tokens t1 ON pk.chain_id = t1.chain_id AND pk.token1 = t1.token_address
         LEFT JOIN erc20_tokens_latest_price t1p ON t1p.chain_id = t1.chain_id AND t1p.token_address = t1.token_address
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
WHERE pk.chain_id = COALESCE(${chainId ?? null}, pk.chain_id)
  AND t0.visibility_priority >= 0
  AND t1.visibility_priority >= 0
GROUP BY pk.token0, pk.token1, pk.chain_id, t0.token_decimals, t1.token_decimals
HAVING SUM(tvl0_total / POWER(10::NUMERIC, t0.token_decimals) * COALESCE(t0p.value, 0::NUMERIC) +
           tvl1_total / POWER(10::NUMERIC, t1.token_decimals) * COALESCE(t1p.value, 0::NUMERIC))
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
        pool_id: string;
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
        stableswap_center_tick: string | null;
        stableswap_amplification: string | null;
        depth_percent: number | null;
        boosted_fees_donate_rate0: string | null;
        boosted_fees_donate_rate1: string | null;
        boosted_fees_last_donated_time: Date | null;
        boosted_fees_future_deltas:
          | {
              time: string;
              donate_rate_delta0: string;
              donate_rate_delta1: string;
            }[]
          | null;
      }[]
    >`
      SELECT
        p.pool_id,
        p.fee,
        p.tick_spacing,
        p.core_address,
        p.pool_extension AS extension,
        p.stableswap_amplification,
        p.stableswap_center_tick,
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
        depth_percent,
        bps.donate_rate0 AS boosted_fees_donate_rate0,
        bps.donate_rate1 AS boosted_fees_donate_rate1,
        bps.last_donated_time AS boosted_fees_last_donated_time,
        bfrd.future_deltas AS boosted_fees_future_deltas
      FROM
        last_24h_pool_stats_materialized l24
        JOIN pool_keys p USING (pool_key_id)
        JOIN erc20_tokens t0 ON p.chain_id = t0.chain_id AND p.token0 = t0.token_address
        LEFT JOIN erc20_tokens_latest_price t0p ON t0p.chain_id = t0.chain_id AND t0p.token_address = t0.token_address
        JOIN erc20_tokens t1 ON p.chain_id = t1.chain_id AND p.token1 = t1.token_address
         LEFT JOIN erc20_tokens_latest_price t1p ON t1p.chain_id = t1.chain_id AND t1p.token_address = t1.token_address
        LEFT JOIN token_pair_realized_volatility_materialized tprv ON p.chain_id = tprv.chain_id AND p.token0 = tprv.token0 AND p.token1 = tprv.token1
        LEFT JOIN boosted_fees_pool_states bps ON bps.pool_key_id = p.pool_key_id
        LEFT JOIN LATERAL (
          SELECT
            jsonb_agg(
              jsonb_build_object(
                'time',
                EXTRACT(epoch FROM bfrd.time)::text,
                'donate_rate_delta0',
                bfrd.net_donate_rate_delta0::text,
                'donate_rate_delta1',
                bfrd.net_donate_rate_delta1::text
              )
              ORDER BY bfrd.time
            ) AS future_deltas
          FROM
            boosted_fees_donate_rate_deltas bfrd
          WHERE
            bfrd.pool_key_id = p.pool_key_id
            AND bps.pool_key_id IS NOT NULL
            AND bfrd.time > bps.last_donated_time
        ) bfrd ON TRUE
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
          (
            (tvl0_total / POWER(10::numeric, t0.token_decimals)) * COALESCE(t0p.value, 0::numeric) +
            (tvl1_total / POWER(10::numeric, t1.token_decimals)) * COALESCE(t1p.value, 0::numeric)
          ) >= ${minTvlUsd}
          OR COALESCE(bps.donate_rate0, 0::numeric) <> 0
          OR COALESCE(bps.donate_rate1, 0::numeric) <> 0
        )
    `;
  }

  public async getBoostedFeesPools(chainId: bigint | null) {
    return this.sql<
      {
        chain_id: bigint;
        token0: string;
        token1: string;
        pool_id: string;
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
        stableswap_center_tick: string | null;
        stableswap_amplification: string | null;
        depth_percent: number | null;
        boosted_fees_donate_rate0: string | null;
        boosted_fees_donate_rate1: string | null;
        boosted_fees_last_donated_time: Date | null;
        boosted_fees_future_deltas:
          | {
              time: string;
              donate_rate_delta0: string;
              donate_rate_delta1: string;
            }[]
          | null;
      }[]
    >`
      SELECT
        p.chain_id,
        p.token0,
        p.token1,
        p.pool_id,
        p.fee,
        p.tick_spacing,
        p.core_address,
        p.pool_extension AS extension,
        p.stableswap_amplification,
        p.stableswap_center_tick,
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
        depth_percent,
        bps.donate_rate0 AS boosted_fees_donate_rate0,
        bps.donate_rate1 AS boosted_fees_donate_rate1,
        bps.last_donated_time AS boosted_fees_last_donated_time,
        bfrd.future_deltas AS boosted_fees_future_deltas
      FROM
        last_24h_pool_stats_materialized l24
        JOIN pool_keys p USING (pool_key_id)
        JOIN erc20_tokens t0 ON p.chain_id = t0.chain_id AND p.token0 = t0.token_address
        LEFT JOIN erc20_tokens_latest_price t0p ON t0p.chain_id = t0.chain_id AND t0p.token_address = t0.token_address
        JOIN erc20_tokens t1 ON p.chain_id = t1.chain_id AND p.token1 = t1.token_address
        LEFT JOIN erc20_tokens_latest_price t1p ON t1p.chain_id = t1.chain_id AND t1p.token_address = t1.token_address
        LEFT JOIN token_pair_realized_volatility_materialized tprv ON p.chain_id = tprv.chain_id AND p.token0 = tprv.token0 AND p.token1 = tprv.token1
        JOIN boosted_fees_pool_states bps ON bps.pool_key_id = p.pool_key_id
        LEFT JOIN LATERAL (
          SELECT
            jsonb_agg(
              jsonb_build_object(
                'time',
                EXTRACT(epoch FROM bfrd.time)::text,
                'donate_rate_delta0',
                bfrd.net_donate_rate_delta0::text,
                'donate_rate_delta1',
                bfrd.net_donate_rate_delta1::text
              )
              ORDER BY bfrd.time
            ) AS future_deltas
          FROM
            boosted_fees_donate_rate_deltas bfrd
          WHERE
            bfrd.pool_key_id = p.pool_key_id
            AND bfrd.time > bps.last_donated_time
        ) bfrd ON TRUE
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
        p.chain_id = COALESCE(${chainId ?? null}, p.chain_id)
      ORDER BY
        CASE
          WHEN COALESCE(bps.donate_rate0, 0::numeric) <> 0
            OR COALESCE(bps.donate_rate1, 0::numeric) <> 0 THEN 0
          ELSE 1
        END,
        bps.last_donated_time DESC NULLS LAST,
        p.chain_id,
        p.token0,
        p.token1,
        p.pool_id
    `;
  }

  public async getPositionsByAddress(
    addresses: bigint[],
    state: StateFilter | null = null,
    chainId: bigint | null = null,
    pagination: { page: number; pageSize: number },
  ) {
    const uniqueAddresses = Array.from(
      new Set(addresses.map((address) => address.toString())),
    );
    if (uniqueAddresses.length === 0) {
      return { rows: [], totalCount: 0 };
    }
    const offset = (pagination.page - 1) * pagination.pageSize;
    const currentOwnerCondition = this.sql`current_owner IN ${this.sql(
      uniqueAddresses,
    )}`;
    const previousOwnerCondition = this.sql`previous_owner IN ${this.sql(
      uniqueAddresses,
    )}`;

    const rows = await this.sql<
      (PositionMetadata & {
        chain_id: bigint;
        token_id: string;
        liquidity: string;
        nft_address: string;
        positions_address: string;
        owner: string | null;
        total_count: number;
        pool_state_sqrt_ratio: string;
        pool_state_tick: string;
        pool_state_liquidity: string;
        pool_state_fee: string;
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
                               nfp.current_owner                     AS owner,
                               token_id,
                               nft_token_salt(token_id_transform, token_id) AS salt,
                               token0,
                               token1,
                               fee,
                               tick_spacing,
                               pool_extension                        AS "extension",
                               lower_bound,
                               upper_bound,
                               liquidity,
                               pool_key_id,
                               last_transfer_event_id,
                               stableswap_center_tick,
                               stableswap_amplification
                        FROM nonfungible_token_positions_view AS nfp
                                 LEFT JOIN nft_locker_mappings nlm USING (chain_id, nft_address)
                                 JOIN pool_keys USING (pool_key_id)
                        WHERE ${chainId ? this.sql`nfp.chain_id = ${chainId}` : this.sql`TRUE`} AND 
                        ${
                          state === "opened"
                            ? this
                                .sql`nfp.liquidity != 0 AND ${currentOwnerCondition}`
                            : state === "closed"
                              ? this
                                  .sql`nfp.liquidity = 0 AND (${previousOwnerCondition} OR ${currentOwnerCondition})`
                              : this
                                  .sql`(${currentOwnerCondition} OR ${previousOwnerCondition})`
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
       pp.owner,
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
       COALESCE(vps.swap_fee, pp.fee) AS pool_state_fee,
       pr.rewards,
       pp.stableswap_center_tick,
       pp.stableswap_amplification
FROM pp
         CROSS JOIN total_count
         LEFT JOIN pool_states ps ON pp.pool_key_id = ps.pool_key_id
         LEFT JOIN ve33_pool_states vps ON pp.pool_key_id = vps.pool_key_id
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
      AND crbpm.salt = pp.salt
    ) pr ON TRUE
ORDER BY pp.last_transfer_event_id DESC;
    `;

    const totalCount = rows[0]?.total_count ?? 0;
    return {
      rows,
      totalCount,
    };
  }

  public async getVe33TokensByAddress(
    address: bigint,
    veTokenAddress: bigint,
    chainId: bigint | null,
    pagination: { page: number; pageSize: number },
  ) {
    const offset = (pagination.page - 1) * pagination.pageSize;
    const chainIdCondition = chainId
      ? this.sql`ot.chain_id = ${chainId}`
      : this.sql`TRUE`;
    type Ve33TokenRow = {
      chain_id: bigint;
      owner: string;
      ve_token_address: string;
      ve33_address: string;
      token_id: string;
      stake_id: string;
      amount: string;
      end_time: Date;
      voted_pool_id: string | null;
      voted_pool_token0: string | null;
      voted_pool_token1: string | null;
      voted_pool_fee: string | null;
      voted_pool_tick_spacing: number | null;
      voted_pool_extension: string | null;
      voted_pool_stableswap_center_tick: string | null;
      voted_pool_stableswap_amplification: string | null;
      pool_key_id: string | null;
      applied_vote_weight: string | null;
      voted_swap_fee: string | null;
      pool_total_vote_weight: string | null;
      minted_at: Date | null;
      mint_transaction_hash: string | null;
      last_stake_changed_event_id: string;
      last_transfer_event_id: string;
      total_count: number;
    };
    type NullableVe33TokenRow = {
      [K in keyof Omit<Ve33TokenRow, "total_count">]: Ve33TokenRow[K] | null;
    } & Pick<Ve33TokenRow, "total_count">;

    const rows = await this.sql<NullableVe33TokenRow[]>`
WITH owned_tokens AS (
       SELECT chain_id,
              nft_address AS ve_token_address,
              token_id,
              current_owner AS owner,
              last_transfer_event_id
       FROM nonfungible_token_owners ot
       WHERE current_owner = ${address.toString()}
         AND nft_address = ${veTokenAddress.toString()}
         AND ${chainIdCondition}
     ),
     stake_states AS (
       SELECT vsc.chain_id,
              vsc.emitter AS ve33_address,
              vsc.owner AS ve_token_address,
              vsc.stake_id,
              vsc.stake_salt,
              vsc.stake_end_time,
              SUM(vsc.delta) AS amount,
              MAX(vsc.event_id) AS last_stake_changed_event_id
       FROM ve33_stake_changed vsc
                JOIN owned_tokens ot
                  ON ot.chain_id = vsc.chain_id
                 AND ot.ve_token_address = vsc.owner
                 AND ot.token_id = vsc.stake_salt
       GROUP BY vsc.chain_id,
                vsc.emitter,
                vsc.owner,
                vsc.stake_id,
                vsc.stake_salt,
                vsc.stake_end_time
       HAVING SUM(vsc.delta) > 0
     ),
     ve33_tokens AS (
       SELECT ot.chain_id,
              ot.owner,
              ot.ve_token_address,
              st.ve33_address,
              ot.token_id,
              st.stake_id,
              st.amount::TEXT AS amount,
              st.stake_end_time AS end_time,
              vote.pool_id AS voted_pool_id,
              vote.token0 AS voted_pool_token0,
              vote.token1 AS voted_pool_token1,
              vote.fee AS voted_pool_fee,
              vote.tick_spacing AS voted_pool_tick_spacing,
              vote.pool_extension AS voted_pool_extension,
              vote.stableswap_center_tick AS voted_pool_stableswap_center_tick,
              vote.stableswap_amplification AS voted_pool_stableswap_amplification,
              vote.pool_key_id::TEXT AS pool_key_id,
              vote.weight::TEXT AS applied_vote_weight,
              vote.voted_swap_fee::TEXT AS voted_swap_fee,
              vps.pool_total_vote_weight::TEXT AS pool_total_vote_weight,
              mint.minted_at,
              mint.mint_transaction_hash::TEXT AS mint_transaction_hash,
              st.last_stake_changed_event_id::TEXT AS last_stake_changed_event_id,
              ot.last_transfer_event_id::TEXT AS last_transfer_event_id
       FROM owned_tokens ot
                JOIN stake_states st
                  ON st.chain_id = ot.chain_id
                 AND st.ve_token_address = ot.ve_token_address
                 AND st.stake_salt = ot.token_id
                LEFT JOIN LATERAL (
                  SELECT vpvs.pool_key_id,
                         vpvs.pool_id,
                         vpvs.weight,
                         vwa.voted_swap_fee,
                         pk.token0,
                         pk.token1,
                         pk.fee,
                         pk.tick_spacing,
                         pk.pool_extension,
                         pk.stableswap_center_tick,
                         pk.stableswap_amplification
                  FROM ve33_pool_vote_states vpvs
                           JOIN ve33_vote_weight_applied vwa
                             ON vwa.chain_id = vpvs.chain_id
                            AND vwa.event_id = vpvs.event_id
                           JOIN pool_keys pk
                             ON pk.chain_id = vpvs.chain_id
                            AND pk.pool_key_id = vpvs.pool_key_id
                  WHERE vpvs.chain_id = st.chain_id
                    AND vpvs.emitter = st.ve33_address
                    AND vpvs.owner = st.ve_token_address
                    AND vpvs.stake_id = st.stake_id
                    AND vpvs.weight > 0
                  ORDER BY vpvs.event_id DESC
                  LIMIT 1
                ) vote ON TRUE
                LEFT JOIN ve33_pool_states vps
                  ON vps.pool_key_id = vote.pool_key_id
                LEFT JOIN LATERAL (
                  SELECT b.block_time AS minted_at,
                         nft.transaction_hash AS mint_transaction_hash
                  FROM nonfungible_token_transfers nft
                           JOIN blocks b USING (chain_id, block_number)
                  WHERE nft.chain_id = ot.chain_id
                    AND nft.emitter = ot.ve_token_address
                    AND nft.token_id = ot.token_id
                    AND nft.from_address = 0
                  ORDER BY nft.event_id
                  LIMIT 1
                ) mint ON TRUE
     ),
     total_count AS (SELECT COUNT(*)::INT AS total_count FROM ve33_tokens)
SELECT pt.*,
       tc.total_count
FROM total_count tc
         LEFT JOIN LATERAL (
           SELECT *
           FROM ve33_tokens
           ORDER BY last_transfer_event_id DESC
           LIMIT ${pagination.pageSize} OFFSET ${offset}
         ) pt ON TRUE
ORDER BY pt.last_transfer_event_id DESC NULLS LAST
    `;

    const totalCount = rows[0]?.total_count ?? 0;
    return {
      rows: rows.filter((row): row is Ve33TokenRow => row.chain_id !== null),
      totalCount,
    };
  }

  public async getVe33Pools(
    ve33Address: bigint,
    chainId: bigint,
    pagination: { page: number; pageSize: number | undefined },
  ) {
    const offset =
      pagination.pageSize === undefined
        ? 0
        : (pagination.page - 1) * pagination.pageSize;
    type Ve33PoolRow = {
      chain_id: bigint;
      pool_key_id: string;
      pool_id: string;
      token0: string;
      token1: string;
      fee: string;
      tick_spacing: number | null;
      core_address: string;
      extension: string;
      stableswap_center_tick: string | null;
      stableswap_amplification: string | null;
      pool_state_sqrt_ratio: string | null;
      pool_state_tick: number | null;
      pool_state_liquidity: string | null;
      pool_total_vote_weight: string;
      swap_fee: string;
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
      last_event_id: string;
      total_count: number;
      total_vote_weight: string;
    };
    type NullableVe33PoolRow = {
      [K in keyof Omit<Ve33PoolRow, "total_count" | "total_vote_weight">]:
        | Ve33PoolRow[K]
        | null;
    } & Pick<Ve33PoolRow, "total_count" | "total_vote_weight">;

    const rows = await this.sql<NullableVe33PoolRow[]>`
WITH ve33_pools AS (
       SELECT pk.chain_id,
              pk.pool_key_id::TEXT AS pool_key_id,
              pk.pool_id,
              pk.token0,
              pk.token1,
              pk.fee,
              pk.tick_spacing,
              pk.core_address,
              pk.pool_extension AS extension,
              pk.stableswap_center_tick,
              pk.stableswap_amplification,
              ps.sqrt_ratio AS pool_state_sqrt_ratio,
              ps.tick AS pool_state_tick,
              ps.liquidity AS pool_state_liquidity,
              COALESCE(vps.pool_total_vote_weight, 0)::TEXT AS pool_total_vote_weight,
              COALESCE(vps.swap_fee, 0::NUMERIC)::TEXT AS swap_fee,
              COALESCE(l24.volume0_24h, 0::NUMERIC)::TEXT AS volume0_24h,
              COALESCE(l24.volume1_24h, 0::NUMERIC)::TEXT AS volume1_24h,
              COALESCE(l24.fees0_24h, 0::NUMERIC)::TEXT AS fees0_24h,
              COALESCE(l24.fees1_24h, 0::NUMERIC)::TEXT AS fees1_24h,
              COALESCE(l24.tvl0_total, 0::NUMERIC)::TEXT AS tvl0_total,
              COALESCE(l24.tvl1_total, 0::NUMERIC)::TEXT AS tvl1_total,
              COALESCE(l24.tvl0_delta_24h, 0::NUMERIC)::TEXT AS tvl0_delta_24h,
              COALESCE(l24.tvl1_delta_24h, 0::NUMERIC)::TEXT AS tvl1_delta_24h,
              COALESCE(pmd.depth0, 0::NUMERIC)::TEXT AS depth0,
              COALESCE(pmd.depth1, 0::NUMERIC)::TEXT AS depth1,
              pmd.depth_percent,
              COALESCE(vps.last_event_id, 0)::TEXT AS last_event_id
       FROM pool_keys pk
                LEFT JOIN ve33_pool_states vps USING (pool_key_id)
                LEFT JOIN pool_states ps USING (pool_key_id)
                LEFT JOIN last_24h_pool_stats_materialized l24 USING (pool_key_id)
                LEFT JOIN token_pair_realized_volatility_materialized tprv
                  ON pk.chain_id = tprv.chain_id
                 AND pk.token0 = tprv.token0
                 AND pk.token1 = tprv.token1
                LEFT JOIN LATERAL (
                  SELECT *
                  FROM pool_market_depth_materialized pmd
                  WHERE pk.pool_key_id = pmd.pool_key_id
                    AND GREATEST(COALESCE(tprv.realized_volatility, 0.001), 0.001) >= pmd.depth_percent
                  ORDER BY depth_percent DESC
                  LIMIT 1
                ) AS pmd ON TRUE
       WHERE pk.chain_id = ${chainId}
         AND pk.pool_extension = ${ve33Address.toString()}
     ),
     pool_totals AS (
       SELECT COUNT(*)::INT AS total_count,
              COALESCE(SUM(pool_total_vote_weight::NUMERIC), 0)::TEXT AS total_vote_weight
       FROM ve33_pools
     )
SELECT vp.*,
       pt.total_count,
       pt.total_vote_weight
FROM pool_totals pt
         LEFT JOIN LATERAL (
           SELECT *
           FROM ve33_pools
           ORDER BY pool_total_vote_weight::NUMERIC DESC, last_event_id::NUMERIC DESC
           LIMIT COALESCE(${pagination.pageSize ?? null}, pt.total_count) OFFSET ${offset}
         ) vp ON TRUE
ORDER BY vp.pool_total_vote_weight::NUMERIC DESC NULLS LAST, vp.last_event_id::NUMERIC DESC NULLS LAST
    `;

    const totalCount = rows[0]?.total_count ?? 0;
    const totalVoteWeight = rows[0]?.total_vote_weight ?? "0";
    return {
      rows: rows.filter((row): row is Ve33PoolRow => row.chain_id !== null),
      totalCount,
      totalVoteWeight,
    };
  }

  public async getVe33Bribes(
    bribesAddress: bigint,
    chainId: bigint,
    filters: { activeOnly: boolean },
    pagination: { page: number; pageSize: number | undefined },
  ) {
    const offset =
      pagination.pageSize === undefined
        ? 0
        : (pagination.page - 1) * pagination.pageSize;
    type Ve33BribeRow = {
      chain_id: bigint;
      bribe_id: string;
      pool_id: string;
      reward_token: string;
      owner: string;
      voting_fee: string;
      pool_key_id: string | null;
      core_address: string | null;
      token0: string | null;
      token1: string | null;
      fee: string | null;
      tick_spacing: number | null;
      extension: string | null;
      stableswap_center_tick: string | null;
      stableswap_amplification: string | null;
      total_weight: string;
      total_scheduled_amount: string;
      current_reward_rate: string;
      first_start_time: Date | string | null;
      last_end_time: Date | string | null;
      schedules: {
        funder: string;
        start_time: string;
        end_time: string;
        reward_rate: string;
        amount: string;
      }[];
      total_count: number;
    };
    type NullableVe33BribeRow = {
      [K in keyof Omit<Ve33BribeRow, "total_count">]: Ve33BribeRow[K] | null;
    } & Pick<Ve33BribeRow, "total_count">;

    const rows = await this.sql<NullableVe33BribeRow[]>`
WITH schedules AS (
       SELECT r.bribe_id,
              json_agg(
                json_build_object(
                  'funder', r.funder::TEXT,
                  'start_time', r.start_time,
                  'end_time', r.end_time,
                  'reward_rate', r.reward_rate::TEXT,
                  'amount', r.amount::TEXT
                )
                ORDER BY r.start_time, r.event_id
              ) AS schedules,
              SUM(r.amount)::TEXT AS total_scheduled_amount,
              COALESCE(
                SUM(r.reward_rate) FILTER (WHERE r.start_time <= now() AND r.end_time > now()),
                0
              )::TEXT AS current_reward_rate,
              MIN(r.start_time) AS first_start_time,
              MAX(r.end_time) AS last_end_time
       FROM ve_token_bribes_rewards_scheduled r
       WHERE r.chain_id = ${chainId}
         AND r.emitter = ${bribesAddress.toString()}
       GROUP BY r.bribe_id
     ),
     weights AS (
       SELECT bribe_id,
              SUM(delta)::TEXT AS total_weight
       FROM (
         SELECT s.bribe_id, s.weight AS delta
         FROM ve_token_bribes_staked s
         WHERE s.chain_id = ${chainId} AND s.emitter = ${bribesAddress.toString()}
         UNION ALL
         SELECT u.bribe_id, -u.weight
         FROM ve_token_bribes_unstaked u
         WHERE u.chain_id = ${chainId} AND u.emitter = ${bribesAddress.toString()}
         UNION ALL
         SELECT v.bribe_id, v.weight - v.previous_weight
         FROM ve_token_bribes_vote_refreshed v
         WHERE v.chain_id = ${chainId} AND v.emitter = ${bribesAddress.toString()}
       ) deltas
       GROUP BY bribe_id
     ),
     current_fees AS (
       SELECT DISTINCT ON (u.bribe_id) u.bribe_id,
              u.voting_fee
       FROM ve_token_bribes_voting_fee_updated u
       WHERE u.chain_id = ${chainId}
         AND u.emitter = ${bribesAddress.toString()}
       ORDER BY u.bribe_id, u.event_id DESC
     ),
     bribes AS (
       SELECT c.chain_id,
              c.bribe_id,
              c.pool_id,
              c.reward_token,
              c.owner,
              COALESCE(f.voting_fee, c.voting_fee) AS voting_fee,
              pk.pool_key_id::TEXT AS pool_key_id,
              pk.core_address,
              pk.token0,
              pk.token1,
              pk.fee,
              pk.tick_spacing,
              pk.pool_extension AS extension,
              pk.stableswap_center_tick,
              pk.stableswap_amplification,
              COALESCE(w.total_weight, '0') AS total_weight,
              COALESCE(s.total_scheduled_amount, '0') AS total_scheduled_amount,
              COALESCE(s.current_reward_rate, '0') AS current_reward_rate,
              s.first_start_time,
              s.last_end_time,
              COALESCE(s.schedules, '[]'::JSON) AS schedules
       FROM ve_token_bribes_created c
                LEFT JOIN pool_keys pk USING (pool_key_id)
                LEFT JOIN current_fees f ON f.bribe_id = c.bribe_id
                LEFT JOIN schedules s ON s.bribe_id = c.bribe_id
                LEFT JOIN weights w ON w.bribe_id = c.bribe_id
       WHERE c.chain_id = ${chainId}
         AND c.emitter = ${bribesAddress.toString()}
         AND (${!filters.activeOnly} OR s.last_end_time > now())
     ),
     bribe_totals AS (
       SELECT COUNT(*)::INT AS total_count FROM bribes
     )
SELECT b.*,
       bt.total_count
FROM bribe_totals bt
         LEFT JOIN LATERAL (
           SELECT *
           FROM bribes
           ORDER BY current_reward_rate::NUMERIC DESC, total_scheduled_amount::NUMERIC DESC, bribe_id
           LIMIT COALESCE(${pagination.pageSize ?? null}, bt.total_count) OFFSET ${offset}
         ) b ON TRUE
ORDER BY b.current_reward_rate::NUMERIC DESC NULLS LAST, b.total_scheduled_amount::NUMERIC DESC NULLS LAST, b.bribe_id NULLS LAST
    `;

    const totalCount = rows[0]?.total_count ?? 0;
    return {
      rows: rows.filter((row): row is Ve33BribeRow => row.chain_id !== null),
      totalCount,
    };
  }

  private async getTopPositions({
    chainId,
    limit,
    pair,
    coreAddress,
    poolId,
  }: {
    chainId: bigint;
    limit: number;
    pair?: { token0: bigint; token1: bigint };
    coreAddress?: bigint;
    poolId?: bigint;
  }) {
    if (
      pair === undefined &&
      coreAddress === undefined &&
      poolId === undefined
    ) {
      throw new Error("Top positions query requires at least one filter");
    }

    const pairCondition = pair
      ? this
          .sql`pk.token0 = ${pair.token0.toString()} AND pk.token1 = ${pair.token1.toString()}`
      : this.sql`TRUE`;
    const coreAddressCondition =
      coreAddress !== undefined
        ? this.sql`pk.core_address = ${coreAddress.toString()}`
        : this.sql`TRUE`;
    const poolIdCondition =
      poolId !== undefined
        ? this.sql`pk.pool_id = ${poolId.toString()}`
        : this.sql`TRUE`;

    return this.sql<
      {
        chain_id: bigint;
        nft_address: string;
        core_address: string;
        positions_address: string;
        owner: string;
        token_id: string;
        token0: string;
        token1: string;
        fee: string;
        tick_spacing: string | null;
        extension: string;
        lower_bound: string;
        upper_bound: string;
        liquidity: string;
        minted_timestamp: Date;
        pool_state_sqrt_ratio: string | null;
        pool_state_tick: number | null;
        pool_state_liquidity: string | null;
        stableswap_center_tick: number | null;
        stableswap_amplification: string | null;
      }[]
    >`
      SELECT nfp.chain_id,
             nfp.nft_address,
             pk.core_address,
             COALESCE(nlm.locker, nfp.nft_address) AS positions_address,
             nfp.current_owner AS owner,
             nfp.token_id,
             pk.token0,
             pk.token1,
             pk.fee,
             pk.tick_spacing,
             pk.pool_extension                      AS "extension",
             nfp.lower_bound,
             nfp.upper_bound,
             nfp.liquidity,
             mint.minted_timestamp,
             ps.sqrt_ratio AS pool_state_sqrt_ratio,
             ps.tick       AS pool_state_tick,
             ps.liquidity  AS pool_state_liquidity,
             pk.stableswap_center_tick,
             pk.stableswap_amplification
      FROM nonfungible_token_positions_view AS nfp
               LEFT JOIN nft_locker_mappings nlm USING (chain_id, nft_address)
               JOIN pool_keys pk USING (pool_key_id)
               LEFT JOIN LATERAL (
        SELECT b.block_time AS minted_timestamp
        FROM nonfungible_token_transfers nft
                 JOIN blocks b USING (chain_id, block_number)
        WHERE nft.chain_id = nfp.chain_id
          AND nft.emitter = nfp.nft_address
          AND nft.token_id = nfp.token_id
          AND nft.from_address = 0
        ORDER BY nft.event_id
        LIMIT 1
      ) mint ON TRUE
               LEFT JOIN pool_states ps ON pk.pool_key_id = ps.pool_key_id
      WHERE nfp.chain_id = ${chainId}
        AND ${pairCondition}
        AND nfp.liquidity != 0
        AND ${coreAddressCondition}
        AND ${poolIdCondition}
      ORDER BY nfp.liquidity DESC
      LIMIT ${limit};
    `;
  }

  public async getTopPositionsByPair({
    chainId,
    pair,
    poolKeyFilters,
    limit = 10,
  }: {
    chainId: bigint;
    pair: { token0: bigint; token1: bigint };
    poolKeyFilters?: PoolKeyFilters;
    limit?: number;
  }) {
    return this.getTopPositions({
      chainId,
      pair,
      coreAddress: poolKeyFilters?.coreAddress,
      poolId: poolKeyFilters?.poolId,
      limit,
    });
  }

  public async getTopPositionsByPool({
    chainId,
    coreAddress,
    poolId,
    limit = 10,
  }: {
    chainId: bigint;
    coreAddress: bigint;
    poolId: bigint;
    limit?: number;
  }) {
    return this.getTopPositions({
      chainId,
      coreAddress,
      poolId,
      limit,
    });
  }

  async listCampaigns(chainId: bigint | null = null) {
    return this.sql<
      {
        chain_id: bigint;
        core_address: string;
        allowed_lockers: string[] | null;
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
  core_address,
  allowed_lockers,
  slug,
  start_time,
  end_time,
  name,
  reward_token,
  next_drop_time,
  allowed_extensions,
  rewards
FROM incentives.campaign_rewards_overview_materialized
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
                               COALESCE(dac.address, fr.drop_address) AS drop_address,
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
AND chain_id IS NOT NULL
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
                      AND gv.chain_id = b.chain_id
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
              AND gv.chain_id = b.chain_id
          WHERE
            pdvwm.proposal_id = ${proposalId.toString()}
            AND pdvwm.chain_id = ${chainId.toString()}
          ORDER BY
            weight DESC
          LIMIT 100;
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

  async listAuctionsByKey({
    chainId,
    minVisibilityPriority,
    owner,
  }: {
    chainId: bigint | null;
    minVisibilityPriority: number;
    owner: bigint | null;
  }) {
    const chainIdCondition =
      chainId === null ? this.sql`TRUE` : this.sql`afa.chain_id = ${chainId}`;

    const ownerCondition =
      owner === null
        ? this.sql`TRUE`
        : this.sql`nfo.current_owner = ${owner.toString()}`;

    return this.sql<
      {
        chain_id: bigint;
        token0: string;
        token1: string;
        config: string;
        token_id: string;
        owner: string;
        auctions_contract_address: string;
        total_sale_rate: string;
        completed_timestamp: Date | null;
        boost_end_time: Date | null;
      }[]
    >`
      WITH auction_keys AS (
        SELECT afa.chain_id,
              afa.token0,
              afa.token1,
              afa.config,
              afa.token_id       AS token_id,
              nfo.current_owner  AS owner,
              afa.emitter        AS auctions_contract_address,
              SUM(afa.sale_rate) AS total_sale_rate,
              MAX(b.block_time)  AS last_funded_timestamp
        FROM auction_funds_added AS afa
                JOIN nonfungible_token_owners AS nfo
                      ON nfo.chain_id = afa.chain_id
                          AND nfo.nft_address = afa.emitter
                          AND nfo.token_id = afa.token_id
                JOIN blocks AS b
                      ON b.chain_id = afa.chain_id
                          AND b.block_number = afa.block_number
                JOIN erc20_tokens AS t0
                      ON t0.chain_id = afa.chain_id
                          AND t0.token_address = afa.token0
                JOIN erc20_tokens AS t1
                      ON t1.chain_id = afa.chain_id
                          AND t1.token_address = afa.token1
        WHERE ${chainIdCondition}
          AND t0.visibility_priority >= ${minVisibilityPriority}
          AND t1.visibility_priority >= ${minVisibilityPriority}
          AND ${ownerCondition}
        GROUP BY afa.chain_id,
                afa.token0,
                afa.token1,
                afa.config,
                afa.token_id,
                nfo.current_owner,
                afa.emitter
      ),
           completion_data AS (
             SELECT DISTINCT ON (
               ac.chain_id,
               ac.emitter,
               ac.token_id,
               ac.token0,
               ac.token1,
               ac.config
             )
               ac.chain_id,
               ac.emitter AS auctions_contract_address,
               ac.token_id,
               ac.token0,
               ac.token1,
               ac.config,
               b.block_time AS completed_timestamp
             FROM auction_completed AS ac
                    JOIN auction_keys AS ak
                         ON ak.chain_id = ac.chain_id
                             AND ak.auctions_contract_address = ac.emitter
                             AND ak.token_id = ac.token_id
                             AND ak.token0 = ac.token0
                             AND ak.token1 = ac.token1
                             AND ak.config = ac.config
                    JOIN blocks AS b
                         ON b.chain_id = ac.chain_id
                             AND b.block_number = ac.block_number
             ORDER BY ac.chain_id,
                      ac.emitter,
                      ac.token_id,
                      ac.token0,
                      ac.token1,
                      ac.config,
                      ac.event_id DESC
           ),
           boost_data AS (
             SELECT DISTINCT ON (
               abs.chain_id,
               abs.emitter,
               abs.token0,
               abs.token1,
               abs.config
             )
               abs.chain_id,
               abs.emitter AS auctions_contract_address,
               abs.token0,
               abs.token1,
               abs.config,
               abs.boost_end_time
             FROM auction_boost_started AS abs
                    JOIN auction_keys AS ak
                         ON ak.chain_id = abs.chain_id
                             AND ak.auctions_contract_address = abs.emitter
                             AND ak.token0 = abs.token0
                             AND ak.token1 = abs.token1
                             AND ak.config = abs.config
             ORDER BY abs.chain_id,
                      abs.emitter,
                      abs.token0,
                      abs.token1,
                      abs.config,
                      abs.event_id DESC
           )
      SELECT ak.chain_id,
            ak.token0,
            ak.token1,
            ak.config,
            ak.token_id,
            ak.owner,
            ak.auctions_contract_address,
            ak.total_sale_rate,
            cd.completed_timestamp,
            bd.boost_end_time
      FROM auction_keys AS ak
              LEFT JOIN completion_data AS cd
                        ON cd.chain_id = ak.chain_id
                            AND cd.auctions_contract_address =
                                ak.auctions_contract_address
                            AND cd.token_id = ak.token_id
                            AND cd.token0 = ak.token0
                            AND cd.token1 = ak.token1
                            AND cd.config = ak.config
              LEFT JOIN boost_data AS bd
                        ON bd.chain_id = ak.chain_id
                            AND bd.auctions_contract_address =
                                ak.auctions_contract_address
                            AND bd.token0 = ak.token0
                            AND bd.token1 = ak.token1
                            AND bd.config = ak.config
      ORDER BY ak.last_funded_timestamp DESC, ak.token_id
    `;
  }

  async getAuctionNftMetadata(
    tokenId: bigint,
    nftAddress: bigint,
    chainId: bigint,
  ) {
    return this.sql<AuctionNftMetadata[]>`
      WITH minted AS (
        SELECT nft.transaction_hash AS minted_tx_hash,
               b.block_time AS minted_timestamp
        FROM nonfungible_token_transfers AS nft
               JOIN blocks AS b
                    ON b.chain_id = nft.chain_id
                        AND b.block_number = nft.block_number
        WHERE nft.chain_id = ${chainId}
          AND nft.emitter = ${nftAddress.toString()}
          AND nft.token_id = ${tokenId.toString()}
          AND nft.from_address = 0
        ORDER BY nft.event_id
        LIMIT 1
      ),
           owner_data AS (
             SELECT nfo.current_owner
             FROM nonfungible_token_owners AS nfo
             WHERE nfo.chain_id = ${chainId}
               AND nfo.nft_address = ${nftAddress.toString()}
               AND nfo.token_id = ${tokenId.toString()}
           ),
           auction_keys AS (
             SELECT afa.token0,
                    afa.token1,
                    afa.config,
                    SUM(afa.sale_rate) AS total_sale_rate,
                    MIN(b.block_time)  AS first_funded_timestamp,
                    MAX(b.block_time)  AS last_funded_timestamp,
                    COUNT(*)::INT      AS fund_add_events
             FROM auction_funds_added AS afa
                    JOIN blocks AS b
                         ON b.chain_id = afa.chain_id
                             AND b.block_number = afa.block_number
             WHERE afa.chain_id = ${chainId}
               AND afa.emitter = ${nftAddress.toString()}
               AND afa.token_id = ${tokenId.toString()}
             GROUP BY afa.token0, afa.token1, afa.config
           ),
           proceeds_data AS (
             SELECT acp.token0,
                    acp.token1,
                    acp.config,
                    SUM(acp.amount) AS creator_proceeds,
                    COUNT(*)::INT   AS proceeds_collect_events
             FROM auction_creator_proceeds_collected AS acp
             WHERE acp.chain_id = ${chainId}
               AND acp.emitter = ${nftAddress.toString()}
               AND acp.token_id = ${tokenId.toString()}
             GROUP BY acp.token0, acp.token1, acp.config
           ),
           completion_data AS (
             SELECT DISTINCT ON (ac.token0, ac.token1, ac.config)
               ac.token0,
               ac.token1,
               ac.config,
               ac.creator_amount,
               ac.boost_amount,
               b.block_time AS completed_timestamp
             FROM auction_completed AS ac
                    JOIN blocks AS b
                         ON b.chain_id = ac.chain_id
                             AND b.block_number = ac.block_number
             WHERE ac.chain_id = ${chainId}
               AND ac.emitter = ${nftAddress.toString()}
               AND ac.token_id = ${tokenId.toString()}
             ORDER BY ac.token0, ac.token1, ac.config, ac.event_id DESC
           ),
           boost_data AS (
             SELECT DISTINCT ON (abs.token0, abs.token1, abs.config)
               abs.token0,
               abs.token1,
               abs.config,
               abs.boost_rate,
               abs.boost_end_time
             FROM auction_boost_started AS abs
             WHERE abs.chain_id = ${chainId}
               AND abs.emitter = ${nftAddress.toString()}
             ORDER BY abs.token0, abs.token1, abs.config, abs.event_id DESC
           ),
           auction_participants AS (
             SELECT ak.token0,
                    ak.token1,
                    ak.config,
                    COUNT(DISTINCT COALESCE(NULLIF(nfov.current_owner, 0), nfov.previous_owner))::INT AS participants_count
             FROM auction_keys AS ak
                    LEFT JOIN LATERAL (
                      SELECT MOD(FLOOR(ak.config / POW(2::NUMERIC, 216)), POW(2::NUMERIC, 8)) <> 0 AS auction_is_selling_token1,
                             TO_TIMESTAMP(
                               MOD(FLOOR(ak.config / POW(2::NUMERIC, 32)), POW(2::NUMERIC, 64))::DOUBLE PRECISION
                             )                                                                       AS auction_start_time,
                             TO_TIMESTAMP(
                               (
                                 MOD(FLOOR(ak.config / POW(2::NUMERIC, 32)), POW(2::NUMERIC, 64)) +
                                 MOD(ak.config, POW(2::NUMERIC, 32))
                               )::DOUBLE PRECISION
                             )                                                                       AS auction_end_time
                    ) AS cfg ON TRUE
                    LEFT JOIN pool_keys AS pk
                              ON pk.chain_id = ${chainId}
                                  AND pk.token0 = ak.token0
                                  AND pk.token1 = ak.token1
                                  AND pk.fee = 0
                    LEFT JOIN nonfungible_token_orders_view AS nfov
                              ON nfov.chain_id = ${chainId}
                                  AND nfov.pool_key_id = pk.pool_key_id
                                  AND nfov.start_time = cfg.auction_start_time
                                  AND nfov.end_time = cfg.auction_end_time
                                  AND nfov.is_selling_token1 <> cfg.auction_is_selling_token1
             GROUP BY ak.token0, ak.token1, ak.config
           )
      SELECT minted.minted_tx_hash,
             minted.minted_timestamp,
             owner_data.current_owner,
             ak.token0,
             ak.token1,
             ak.config,
             t0.token_symbol AS token0_symbol,
             t1.token_symbol AS token1_symbol,
             ak.total_sale_rate,
             ak.first_funded_timestamp,
             ak.last_funded_timestamp,
             ak.fund_add_events,
             COALESCE(ap.participants_count, 0)::INT AS participants_count,
             pd.creator_proceeds,
             pd.proceeds_collect_events,
             cd.creator_amount,
             cd.boost_amount,
             cd.completed_timestamp,
             bd.boost_rate,
             bd.boost_end_time
      FROM auction_keys AS ak
             JOIN minted ON TRUE
             LEFT JOIN owner_data ON TRUE
             LEFT JOIN erc20_tokens AS t0
                       ON t0.chain_id = ${chainId}
                           AND t0.token_address = ak.token0
             LEFT JOIN erc20_tokens AS t1
                       ON t1.chain_id = ${chainId}
                           AND t1.token_address = ak.token1
             LEFT JOIN proceeds_data AS pd
                       ON pd.token0 = ak.token0
                           AND pd.token1 = ak.token1
                           AND pd.config = ak.config
             LEFT JOIN completion_data AS cd
                       ON cd.token0 = ak.token0
                           AND cd.token1 = ak.token1
                           AND cd.config = ak.config
             LEFT JOIN boost_data AS bd
                       ON bd.token0 = ak.token0
                           AND bd.token1 = ak.token1
                           AND bd.config = ak.config
             LEFT JOIN auction_participants AS ap
                       ON ap.token0 = ak.token0
                           AND ap.token1 = ak.token1
                           AND ap.config = ak.config
      ORDER BY ak.last_funded_timestamp DESC, ak.token0, ak.token1, ak.config
    `;
  }

  async getLimitOrdersByAddress(
    address: bigint,
    state: StateFilter | null,
    chainId: bigint | null,
    pagination: { page: number; pageSize: number },
  ) {
    const includeOpened = state === "opened" || state === null;
    const includeClosed = state === "closed" || state === null;
    const offset = (pagination.page - 1) * pagination.pageSize;

    const rows = await this.sql<
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
        total_count: number;
      }[]
    >`
WITH owned_tokens AS (SELECT chain_id, token_id
                      FROM nonfungible_token_owners pt1
                      WHERE chain_id = COALESCE(${chainId?.toString() ?? null}, chain_id)
                        AND current_owner = ${address.toString()}),
     filtered_orders AS (SELECT ot.chain_id,
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
                             SELECT event_id AS close_event_id,
                                    amount0  AS token0_amount_withdrawn,
                                    amount1  AS token1_amount_withdrawn
                             FROM limit_order_closed
                             WHERE salt = ot.token_id::NUMERIC
                             ORDER BY event_id DESC
                             LIMIT 1
                             ) AS lc ON TRUE
                         WHERE (
                                   (${includeClosed} AND lc.close_event_id IS NOT NULL)
                                       OR (${includeOpened} AND
                                           (lc.close_event_id IS NULL OR lc.close_event_id < lo.open_event_id))
                                   )),
     total_count AS (SELECT COUNT(*)::INT AS total_count FROM filtered_orders),
     paginated_orders AS (SELECT *
                          FROM filtered_orders
                          ORDER BY token_id DESC
                          LIMIT ${pagination.pageSize} OFFSET ${offset})
SELECT po.chain_id,
       po.token_id,
       po.token0,
       po.token1,
       po.tick,
       po.liquidity,
       po.amount,
       po.token0_amount_withdrawn,
       po.token1_amount_withdrawn,
       total_count.total_count
FROM paginated_orders po
         CROSS JOIN total_count
ORDER BY po.token_id DESC
      `;

    const totalCount = rows[0]?.total_count ?? 0;
    return {
      rows,
      totalCount,
    };
  }
}

export async function createQueries(env: Env) {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? env.PG_CONNECTION_STRING;

  if (!connectionString) throw new Error("No postgres configuration");

  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    debug: true,
    types: { bigint: postgres.BigInt },
    connection: {
      application_name: "ekubo-api",
      default_transaction_read_only: true,
      // set the statement timeout to aggressively disconnect
      statement_timeout: 5_000,
    },
  });

  return new Queries(sql);
}
