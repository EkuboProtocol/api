import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { createQueries } from "../../queries";
import { NFTMetadata, NFTMetadataSchema, TokenIdType } from "./format";
import { generateDcaOrderNft } from "./generateDcaOrderNft";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";
import { generateTwapOrderNftMetadata } from "../../shared/metadatas/twap";

export const GetOrderNftMetadata = defineRoute(
  createRoute({
    method: "get",
    path: "/orders/{chainId}/{nftAddress}/{id}",
    tags: ["Orders"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given order token ID",
    operationId: "get_GetOrderNftMetadata",
    request: {
      params: z.object({
        chainId: NumericStringType,
        nftAddress: AddressType.describe(
          "The address of the Positions NFT contract",
        ),
        id: TokenIdType,
      }),
    },
    responses: {
      200: jsonResponse(
        "The NFT metadata for the given order ID",
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

    const twammOrderMetadata = await queries.getTwammOrderMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    if (!twammOrderMetadata?.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(c.req.url).origin;
    const image = `${origin}/orders/${chainIdParam}/nft/${id}/image.svg`;

    const metadata = generateTwapOrderNftMetadata(twammOrderMetadata, image);

    const response = metadata satisfies NFTMetadata;

    return c.json(response, 200, {
      "cache-control": "public,max-age=3600,immutable",
    });
  },
);

export const GetOrderNftImage = defineRoute(
  createRoute({
    method: "get",
    path: "/orders/{chainId}/{nftAddress}/{id}/image.svg",
    tags: ["Orders"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given order NFT ID",
    operationId: "get_GetOrderNftImage",
    request: {
      params: z.object({
        chainId: NumericStringType,
        nftAddress: AddressType.describe(
          "The address of the Positions NFT contract",
        ),
        id: TokenIdType,
      }),
    },
    responses: {
      200: {
        description: "The order NFT image",
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

    const twammOrderMetadata = await queries.getTwammOrderMetadata(
      id,
      BigInt(nftAddress),
      chainId,
    );

    if (twammOrderMetadata.length === 0) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const svgString = await generateDcaOrderNft(
      id,
      chainIdParam,
      queries,
      twammOrderMetadata,
    );

    return c.body(svgString, 200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, immutable",
    });
  },
);
