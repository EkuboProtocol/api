import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
  ChainIdStringType,
  NumericStringType,
  VisibilityPriorityType,
} from "../../shared/validation/address";
import { createQueries, TwammOrderMetadata } from "../../queries";
import toHex from "../../shared/toHex";
import { NFTMetadata, NFTMetadataSchema, TokenIdType } from "../nft/format";
import { generateDcaOrderNft } from "../nft/generateDcaOrderNft";

function formatAttributeTimestamp(value: Date | null) {
  return value ? Math.floor(value.getTime() / 1000).toString() : null;
}

const AuctionKeyType = z.object({
  token0: AddressType,
  token1: AddressType,
  config: HexStringType,
});

const AuctionSummaryType = z.object({
  chain_id: HexStringType,
  key: AuctionKeyType,
  token_id: HexStringType,
  owner: AddressType,
  auctions_contract_address: AddressType,
  total_sale_rate: DecimalStringType,
  boost_end_time: NumericStringType.nullable(),
  completed_timestamp: NumericStringType.nullable(),
});

const ListAuctionsResponseType = z.object({
  auctions: z.array(AuctionSummaryType),
});

const AuctionStateType = z.object({
  token0: HexStringType,
  token1: HexStringType,
  config: HexStringType,
  total_sale_rate: DecimalStringType,
  participants_count: z.number().int().nonnegative(),
  creator_proceeds_collected: DecimalStringType.nullable(),
  boost_rate: DecimalStringType.nullable(),
  boost_end_time: NumericStringType.nullable(),
  completed_timestamp: NumericStringType.nullable(),
  creator_amount: DecimalStringType.nullable(),
  boost_amount: DecimalStringType.nullable(),
});

const AuctionNftStateResponseType = z.object({
  current_owner: HexStringType.nullable(),
  auctions: z.array(AuctionStateType),
});

export const ListAuctions = defineRoute(
  createRoute({
    method: "get",
    path: "/auctions",
    tags: ["Auctions"],
    summary: "List auction keys",
    description:
      "Lists auction NFTs grouped by token_id + (token0, token1, config)",
    operationId: "get_ListAuctions",
    request: {
      query: z.object({
        chainId: ChainIdType.optional().describe(
          "Chain ID for which to list auctions",
        ),
        minVisibilityPriority: VisibilityPriorityType.optional()
          .describe(
            "Only include auction keys where both tokens meet this visibility priority threshold",
          )
          .default(0),
        owner: AddressType.optional().describe(
          "If provided, only include auction keys linked to NFTs currently owned by this address",
        ),
      }),
    },
    responses: {
      200: jsonResponse("List of auction keys", ListAuctionsResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      chainId = null,
      minVisibilityPriority,
      owner: ownerParam,
    } = c.req.valid("query");

    const owner = ownerParam === undefined ? null : BigInt(ownerParam);

    const queries = await createQueries(c.env);
    const rows = await queries.listAuctionsByKey({
      chainId,
      minVisibilityPriority,
      owner,
    });

    const response = {
      auctions: rows.map((row) => ({
        chain_id: toHex(row.chain_id),
        auctions_contract_address: toHex(BigInt(row.auctions_contract_address)),
        token_id: toHex(BigInt(row.token_id)),
        owner: toHex(BigInt(row.owner)),
        key: {
          token0: toHex(BigInt(row.token0), 20),
          token1: toHex(BigInt(row.token1), 20),
          config: toHex(BigInt(row.config), 32),
        },
        total_sale_rate: row.total_sale_rate,
        boost_end_time: formatAttributeTimestamp(row.boost_end_time),
        completed_timestamp: formatAttributeTimestamp(row.completed_timestamp),
      })),
    } satisfies z.infer<typeof ListAuctionsResponseType>;

    return c.json(response, 200, {
      "cache-control": "public,max-age=180,must-revalidate",
    });
  },
);

export const GetAuctionNftMetadata = defineRoute(
  createRoute({
    method: "get",
    path: "/auctions/{chainId}/{nftAddress}/{id}",
    tags: ["Auctions"],
    summary: "Get auction NFT metadata",
    description:
      "Returns NFT metadata for auction NFTs; route shape matches positions and orders",
    operationId: "get_GetAuctionNftMetadata",
    request: {
      params: z.object({
        chainId: ChainIdStringType.describe(
          "Chain ID for which to generate metadata",
        ),
        nftAddress: AddressType.describe("The NFT contract address"),
        id: TokenIdType,
      }),
    },
    responses: {
      200: jsonResponse(
        "The NFT metadata for the given token ID",
        NFTMetadataSchema,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      nftAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);
    const queries = await createQueries(c.env);

    const auctionRows = await queries.getAuctionNftMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    const origin = new URL(c.req.url).origin;
    const image = `${origin}/auctions/${chainId.toString()}/${nftAddress}/${id.toString()}/image.svg`;

    if (!auctionRows.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const [firstRow] = auctionRows;
    const attributes: NFTMetadata["attributes"] = [
      {
        trait_type: "minted_tx_hash",
        value: toHex(BigInt(firstRow.minted_tx_hash)),
      },
      {
        trait_type: "minted_timestamp",
        value: firstRow.minted_timestamp.getTime().toString(),
      },
      {
        trait_type: "nft_address",
        value: toHex(BigInt(nftAddress)),
      },
      {
        trait_type: "token_id",
        value: id.toString(),
      },
      {
        trait_type: "current_owner",
        value: firstRow.current_owner
          ? toHex(BigInt(firstRow.current_owner))
          : null,
      },
      {
        trait_type: "auction_key_count",
        value: auctionRows.length.toString(),
      },
    ];
    for (const [ix, row] of auctionRows.entries()) {
      attributes.push(
        {
          trait_type: `token0_${ix}`,
          value: toHex(BigInt(row.token0), 20),
        },
        {
          trait_type: `token1_${ix}`,
          value: toHex(BigInt(row.token1), 20),
        },
        {
          trait_type: `token0_symbol_${ix}`,
          value: row.token0_symbol,
        },
        {
          trait_type: `token1_symbol_${ix}`,
          value: row.token1_symbol,
        },
        {
          trait_type: `config_${ix}`,
          value: toHex(BigInt(row.config), 32),
        },
        {
          trait_type: `total_sale_rate_${ix}`,
          value: row.total_sale_rate,
        },
        {
          trait_type: `fund_add_events_${ix}`,
          value: row.fund_add_events.toString(),
        },
        {
          trait_type: `first_funded_timestamp_${ix}`,
          value: formatAttributeTimestamp(row.first_funded_timestamp),
        },
        {
          trait_type: `last_funded_timestamp_${ix}`,
          value: formatAttributeTimestamp(row.last_funded_timestamp),
        },
        {
          trait_type: `creator_proceeds_collected_${ix}`,
          value: row.creator_proceeds,
        },
        {
          trait_type: `creator_proceeds_collect_events_${ix}`,
          value:
            row.proceeds_collect_events === null
              ? null
              : row.proceeds_collect_events.toString(),
        },
        {
          trait_type: `boost_rate_${ix}`,
          value: row.boost_rate,
        },
        {
          trait_type: `boost_end_time_${ix}`,
          value: formatAttributeTimestamp(row.boost_end_time),
        },
        {
          trait_type: `completed_timestamp_${ix}`,
          value: formatAttributeTimestamp(row.completed_timestamp),
        },
        {
          trait_type: `creator_amount_${ix}`,
          value: row.creator_amount,
        },
        {
          trait_type: `boost_amount_${ix}`,
          value: row.boost_amount,
        },
      );
    }

    const metadata: NFTMetadata = {
      name: "Ekubo Auction NFT",
      description: "An Ekubo auction NFT with one or more auction keys",
      image,
      attributes,
    };

    return c.json(metadata, 200, {
      "cache-control": "public,max-age=3600,immutable",
    });
  },
);

export const GetAuctionNftState = defineRoute(
  createRoute({
    method: "get",
    path: "/auctions/{chainId}/{nftAddress}/{id}/state",
    tags: ["Auctions"],
    summary: "Get auction NFT state",
    description: "Returns dynamic auction NFT state for UI consumption",
    operationId: "get_GetAuctionNftState",
    request: {
      params: z.object({
        chainId: ChainIdStringType.describe(
          "Chain ID for which to fetch state",
        ),
        nftAddress: AddressType.describe("The NFT contract address"),
        id: TokenIdType,
      }),
    },
    responses: {
      200: jsonResponse("Auction NFT state data", AuctionNftStateResponseType),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      nftAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);
    const queries = await createQueries(c.env);

    const auctionRows = await queries.getAuctionNftMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    if (!auctionRows.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const [firstRow] = auctionRows;
    const response = {
      current_owner: firstRow.current_owner
        ? toHex(BigInt(firstRow.current_owner))
        : null,
      auctions: auctionRows.map((row) => ({
        token0: toHex(BigInt(row.token0), 20),
        token1: toHex(BigInt(row.token1), 20),
        config: toHex(BigInt(row.config), 32),
        total_sale_rate: row.total_sale_rate,
        participants_count: row.participants_count,
        creator_proceeds_collected: row.creator_proceeds,
        boost_rate: row.boost_rate,
        boost_end_time: formatAttributeTimestamp(row.boost_end_time),
        completed_timestamp: formatAttributeTimestamp(row.completed_timestamp),
        creator_amount: row.creator_amount,
        boost_amount: row.boost_amount,
      })),
    } satisfies z.infer<typeof AuctionNftStateResponseType>;

    return c.json(response, 200, {
      "cache-control": "no-cache",
    });
  },
);

export const GetAuctionNftImage = defineRoute(
  createRoute({
    method: "get",
    path: "/auctions/{chainId}/{nftAddress}/{id}/image.svg",
    tags: ["Auctions"],
    summary: "Get auction NFT image",
    description:
      "Returns the generated NFT image for auction NFTs; route shape matches positions and orders",
    operationId: "get_GetAuctionNftImage",
    request: {
      params: z.object({
        chainId: ChainIdStringType.describe(
          "Chain ID for which to generate metadata",
        ),
        nftAddress: AddressType.describe("The NFT contract address"),
        id: TokenIdType,
      }),
    },
    responses: {
      200: {
        description: "The NFT image",
      },
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const {
      id: idStr,
      chainId: chainIdParam,
      nftAddress,
    } = c.req.valid("param");
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(c.env);

    const auctionRows = await queries.getAuctionNftMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    if (!auctionRows.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const twammOrderMetadatas: TwammOrderMetadata[] = auctionRows.map(
      (row) => ({
        minted_tx_hash: row.minted_tx_hash,
        minted_timestamp: row.minted_timestamp,
        start_time: row.first_funded_timestamp,
        end_time:
          row.completed_timestamp ??
          row.boost_end_time ??
          row.last_funded_timestamp,
        last_update_time: row.last_funded_timestamp,
        token0: row.token0,
        sale_rate0: row.total_sale_rate,
        token1: row.token1,
        sale_rate1: "0",
        fee: "0",
      }),
    );

    const svgString = await generateDcaOrderNft(
      id,
      chainIdParam,
      queries,
      twammOrderMetadatas,
      "auction",
    );

    return c.body(svgString, 200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, immutable",
    });
  },
);
