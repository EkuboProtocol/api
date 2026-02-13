import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
  NumericStringType,
  VisibilityPriorityType,
} from "../../shared/validation/address";
import { z } from "zod";
import { IRequest, json, StatusError } from "itty-router";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import { NFTMetadata, NFTMetadataSchema, TokenIdType } from "../nft/format";
import { generateDcaOrderNft } from "../nft/generateDcaOrderNft";
import { generateTwapOrderNftMetadata } from "../../shared/metadatas/twap";

const AuctionKeyType = z.object({
  token0: AddressType,
  token1: AddressType,
  config: HexStringType,
});

const AuctionSummaryType = z.object({
  key: AuctionKeyType,
  token_id: HexStringType,
  owner: AddressType,
  auctions_contract_address: AddressType,
  total_sale_rate: DecimalStringType,
});

const ListAuctionsResponseType = z.object({
  auctions: z.array(AuctionSummaryType),
});

export class ListAuctions extends EkuboAPIRoute {
  static route = "/auctions";

  static schema: OpenAPIRouteSchema = {
    tags: ["Auctions"],
    summary: "List auction keys",
    description:
      "Lists auction NFTs grouped by token_id + (token0, token1, config)",
    parameters: {
      chainId: Query(ChainIdType, {
        required: false,
        description: "Chain ID for which to list auctions",
      }),
      minVisibilityPriority: Query(VisibilityPriorityType, {
        required: false,
        description:
          "Only include auction keys where both tokens meet this visibility priority threshold",
        default: 0,
      }),
      owner: Query(AddressType, {
        required: false,
        description:
          "If provided, only include auction keys linked to NFTs currently owned by this address",
      }),
    },
    responses: {
      "200": {
        description: "List of auction keys",
        schema: ListAuctionsResponseType,
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const chainId = ChainIdType.optional().parse(query.chainId) ?? null;
    const minVisibilityPriority = VisibilityPriorityType.parse(
      query.minVisibilityPriority ?? 0,
    );

    const owner =
      typeof query.owner === "string"
        ? BigInt(query.owner)
        : (null as bigint | null);

    const queries = await createQueries(env);
    const rows = await queries.listAuctionsByKey({
      chainId,
      minVisibilityPriority,
      owner,
    });

    const response = {
      auctions: rows.map((row) => ({
        auctions_contract_address: toHex(BigInt(row.auctions_contract_address)),
        token_id: toHex(BigInt(row.token_id)),
        owner: toHex(BigInt(row.owner)),
        key: {
          token0: toHex(BigInt(row.token0), 20),
          token1: toHex(BigInt(row.token1), 20),
          config: toHex(BigInt(row.config), 32),
        },
        total_sale_rate: row.total_sale_rate,
      })),
    } satisfies z.infer<typeof ListAuctionsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=180,must-revalidate",
      },
    });
  }
}

export class GetAuctionNftMetadata extends EkuboAPIRoute {
  static route = "/auctions/:chainId/:nftAddress/:id";

  static schema: OpenAPIRouteSchema = {
    tags: ["Auctions"],
    summary: "Get auction NFT metadata",
    description:
      "Returns NFT metadata for auction NFTs; route shape matches positions and orders",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      nftAddress: Path(AddressType, {
        description: "The NFT contract address",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given token ID",
        schema: NFTMetadataSchema,
      },
    },
  };

  async handle(
    { url, params: { id: idStr, chainId: chainIdParam, nftAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);
    const queries = await createQueries(env);

    let metadata: NFTMetadata;

    const twammOrderMetadata = await queries.getTwammOrderMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    const origin = new URL(url).origin;
    const image = `${origin}/auctions/${chainId.toString()}/${nftAddress}/${id.toString()}/image.svg`;

    if (twammOrderMetadata && twammOrderMetadata.length !== 0) {
      metadata = generateTwapOrderNftMetadata(twammOrderMetadata, image);
    } else {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    return json(metadata, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class GetAuctionNftImage extends EkuboAPIRoute {
  static route = "/auctions/:chainId/:nftAddress/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Auctions"],
    summary: "Get auction NFT image",
    description:
      "Returns the generated NFT image for auction NFTs; route shape matches positions and orders",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      nftAddress: Path(AddressType, {
        description: "The NFT contract address",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT image",
      },
    },
  };

  async handle(
    { params: { id: idStr, chainId: chainIdParam, nftAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);
    const chainId = BigInt(chainIdParam);

    const queries = await createQueries(env);

    const twammOrderMetadata = await queries.getTwammOrderMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    if (!twammOrderMetadata?.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const svgString = await generateDcaOrderNft(
      id,
      chainIdParam,
      queries,
      twammOrderMetadata,
    );

    return new Response(svgString, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
}
