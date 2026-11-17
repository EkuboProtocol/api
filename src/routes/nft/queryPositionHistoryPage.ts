import type { Sql } from "postgres";
import type { HistoryCursor, HistorySnapshot } from "./positionHistoryCursor";

export type HistoryPageRequest = {
  chainId: bigint;
  locker: string;
  id: string;
  limit: number;
  cursor: HistoryCursor | null;
};

type SnapshotColumns = Omit<HistorySnapshot, "block_number"> & {
  block_number_snapshot: string;
  last_nonempty_block: string | null;
};

export function queryPositionHistoryPage<Row>(
  sql: Sql<{ bigint: bigint }>,
  { chainId, locker, id, limit, cursor }: HistoryPageRequest,
) {
  const {
    block_number: height,
    block_hash: hash,
    fork_counter: fork,
  } = cursor?.snapshot ?? {
    block_number: null,
    block_hash: null,
    fork_counter: null,
  };
  const lastId = cursor?.event_id ?? null;
  const lastType = cursor?.source_type ?? null;
  const lastNonemptyBlock = cursor === null ? null : cursor.last_nonempty_block;
  const firstPage = cursor === null;
  // A single statement keeps the head, fork check, membership and page in one
  // MVCC snapshot. Empty blocks are not retained in blocks (indexer migration 122).
  return sql<
    (SnapshotColumns & ((Row & { event_id: bigint }) | { event_id: null }))[]
  >`
    WITH fence AS (
      SELECT COALESCE(${height}::bigint, ic.head_block_number) AS height,
             COALESCE(${hash}::numeric, ic.head_block_hash) AS hash,
             COALESCE(${fork}::bigint, ic.fork_counter) AS fork
      FROM indexer_cursor ic
      WHERE ic.chain_id = ${chainId}
        AND ic.head_block_number IS NOT NULL
        AND ic.head_block_hash IS NOT NULL
        AND (${firstPage} OR (
          ic.head_block_number >= ${height}::bigint
          AND ic.fork_counter = ${fork}::bigint
          AND CASE WHEN ic.head_block_number = ${height}::bigint
            THEN ic.head_block_hash = ${hash}::numeric
            ELSE NOT EXISTS (
              SELECT 1 FROM blocks b
              WHERE b.chain_id = ic.chain_id
                AND b.block_number = ${height}::bigint
                AND b.block_hash <> ${hash}::numeric
            ) END
        ))
    ), anchored AS (
      -- A previously empty suffix can acquire events on a reorg without
      -- deleting an eventful block (which is what bumps fork_counter).
      SELECT fence.*, (
        SELECT b.block_number FROM blocks b
        WHERE b.chain_id = ${chainId} AND b.block_number <= fence.height AND b.num_events > 0
        ORDER BY b.block_number DESC LIMIT 1
      ) AS last_nonempty_block
      FROM fence
    ), bounds AS (
      SELECT height, hash, fork, last_nonempty_block,
             LEAST(9223372036854775807, (height::numeric + 1) * 4294967296 - 9223372036854775808)::bigint AS upper_event_id,
             ${lastId}::bigint AS last_id,
             ${lastType}::int AS last_type
      FROM anchored
      WHERE ${firstPage} OR last_nonempty_block IS NOT DISTINCT FROM ${lastNonemptyBlock}::bigint
    ), mints AS (
      SELECT nft.token_id, nft.emitter, nlm.locker,
             nft_token_salt(nlm.token_id_transform, nft.token_id) AS reward_salt,
             nlm.token_id_transform IS NOT NULL AS has_transform
      FROM nonfungible_token_transfers nft
      CROSS JOIN bounds
      LEFT JOIN nft_locker_mappings nlm
        ON nlm.chain_id = nft.chain_id AND nlm.nft_address = nft.emitter
      WHERE nft.chain_id = ${chainId} AND nft.token_id = ${id}::numeric
        AND nft.from_address = 0 AND nft.block_number <= bounds.height
        AND (nft.emitter = ${locker}::numeric OR nlm.locker = ${locker}::numeric)
    ), salts AS (
      SELECT token_id AS salt FROM mints
      UNION
      SELECT reward_salt FROM mints WHERE has_transform
    ), reward_keys AS (
      SELECT DISTINCT reward_salt AS salt, COALESCE(locker, emitter) AS owner
      FROM mints
    ), page AS (
      SELECT events.*, b.block_time AS timestamp
      FROM (
        SELECT 0 AS type, nft.event_id, nft.block_number, nft.transaction_hash,
               nft.from_address, nft.to_address, NULL::numeric AS liquidity_delta,
               NULL::numeric AS delta0, NULL::numeric AS delta1, NULL::text AS reward_amount
        FROM nonfungible_token_transfers nft CROSS JOIN bounds
        WHERE nft.chain_id = ${chainId} AND nft.token_id = ${id}::numeric
          AND nft.from_address <> 0 AND nft.to_address <> 0
          AND nft.event_id <= bounds.upper_event_id
          AND (bounds.last_id IS NULL OR (nft.event_id, 0) < (bounds.last_id, bounds.last_type))
          AND (nft.emitter = ${locker}::numeric OR EXISTS (
            SELECT 1 FROM nft_locker_mappings nlm WHERE nlm.chain_id = nft.chain_id
              AND nlm.nft_address = nft.emitter AND nlm.locker = ${locker}::numeric
          ))
        UNION ALL
        SELECT 1, pu.event_id, pu.block_number, pu.transaction_hash,
               NULL, NULL, pu.liquidity_delta, pu.delta0, pu.delta1, NULL
        FROM position_updates pu CROSS JOIN bounds
        WHERE pu.chain_id = ${chainId} AND pu.event_id <= bounds.upper_event_id
          AND (bounds.last_id IS NULL OR (pu.event_id, 1) < (bounds.last_id, bounds.last_type))
          AND pu.salt IN (SELECT salt FROM salts)
        UNION ALL
        SELECT 2, pfc.event_id, pfc.block_number, pfc.transaction_hash,
               NULL, NULL, NULL, pfc.delta0, pfc.delta1, NULL
        FROM position_fees_collected pfc CROSS JOIN bounds
        WHERE pfc.chain_id = ${chainId} AND pfc.event_id <= bounds.upper_event_id
          AND (bounds.last_id IS NULL OR (pfc.event_id, 2) < (bounds.last_id, bounds.last_type))
          AND pfc.salt IN (SELECT salt FROM salts)
        UNION ALL
        SELECT 3, vrc.event_id, vrc.block_number, vrc.transaction_hash,
               NULL, NULL, NULL, NULL, NULL, vrc.amount::text
        FROM ve33_rewards_claimed vrc CROSS JOIN bounds
        WHERE vrc.chain_id = ${chainId} AND vrc.event_id <= bounds.upper_event_id
          AND (bounds.last_id IS NULL OR (vrc.event_id, 3) < (bounds.last_id, bounds.last_type))
          AND (vrc.salt, vrc.owner) IN (SELECT salt, owner FROM reward_keys)
      ) events
      JOIN blocks b ON b.chain_id = ${chainId} AND b.block_number = events.block_number
      ORDER BY events.event_id DESC, events.type DESC
      LIMIT ${limit + 1}
    )
    SELECT bounds.height::text AS block_number_snapshot, bounds.hash::text AS block_hash,
           bounds.fork::text AS fork_counter, bounds.last_nonempty_block::text, page.*
    FROM bounds LEFT JOIN page ON true
    ORDER BY page.event_id DESC, page.type DESC
  `;
}
