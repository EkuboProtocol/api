import { createRoute, z } from "@hono/zod-openapi";
import { generateDcaOrderNft } from "./generateDcaOrderNft";
import { generateLimitOrderNft } from "./generateLimitOrderNft";
import { generatePositionNft } from "./generatePositionNft";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { NFTMetadata, TokenIdType } from "./format";
import { createQueries, Queries } from "../../queries";
import { generatePositionNftMetadata } from "../../shared/metadatas/positions";
import { generateTwapOrderNftMetadata } from "../../shared/metadatas/twap";
import { generateLimitOrderNftMetadata } from "../../shared/metadatas/limit";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";

const NftParamsType = z.object({
  chainId: NumericStringType.describe(
    "Chain ID for which to generate metadata",
  ),
  nftAddress: AddressType.describe("The address of the NFT contract"),
  id: TokenIdType,
});

// An NFT address can hold positions, TWAMM orders or limit orders; look them up
// in that order and stop at the first kind that has the token.
async function findNftMetadata(
  queries: Queries,
  chainId: bigint,
  nftAddress: bigint,
  id: bigint,
) {
  const positionMetadata = await queries.getPositionMetadata(
    chainId,
    nftAddress,
    id,
  );
  const twammOrderMetadata =
    positionMetadata === null
      ? await queries.getTwammOrderMetadata(id, nftAddress, chainId)
      : null;
  const limitOrderMetadata =
    positionMetadata === null && (twammOrderMetadata?.length ?? 0) === 0
      ? await queries.getLimitOrderMetadata(id, nftAddress, chainId)
      : null;

  return { positionMetadata, twammOrderMetadata, limitOrderMetadata };
}

export const GetNftMetadata = defineRoute(
  createRoute({
    method: "get",
    path: "/nft/{chainId}/{nftAddress}/{id}",
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description:
      "Returns the ERC721 metadata for the given token ID, chain ID and NFT contract address",
    operationId: "get_GetNftMetadata",
    request: { params: NftParamsType },
    responses: {
      200: {
        description: "The NFT metadata for the given position ID",
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
    const chainIdString = chainId.toString();

    const queries = await createQueries(c.env);

    let metadata: NFTMetadata;

    const { positionMetadata, twammOrderMetadata, limitOrderMetadata } =
      await findNftMetadata(queries, chainId, BigInt(nftAddress), id);

    const origin = new URL(c.req.url).origin;
    const image = `${origin}/nft/${chainIdString}/${nftAddress}/${id}/image.svg`;

    if (positionMetadata !== null) {
      metadata = await generatePositionNftMetadata(
        positionMetadata,
        id,
        queries,
        chainId,
        image,
      );
    } else if (twammOrderMetadata && twammOrderMetadata?.length !== 0) {
      metadata = generateTwapOrderNftMetadata(twammOrderMetadata, image);
    } else if (limitOrderMetadata && limitOrderMetadata.length !== 0) {
      metadata = generateLimitOrderNftMetadata(limitOrderMetadata, image);
    } else {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    return c.json(metadata, 200, {
      "cache-control": "public,max-age=3600,immutable",
    });
  },
);

export const GetNftImage = defineRoute(
  createRoute({
    method: "get",
    path: "/nft/{chainId}/{nftAddress}/{id}/image.svg",
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    operationId: "get_GetNftImage",
    request: { params: NftParamsType },
    responses: {
      200: {
        description: "The position NFT image",
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

    const { positionMetadata, twammOrderMetadata, limitOrderMetadata } =
      await findNftMetadata(queries, chainId, BigInt(nftAddress), id);

    let svgString: string | null = null;

    if (positionMetadata !== null) {
      svgString = await generatePositionNft(
        BigInt(id),
        chainIdParam,
        queries,
        positionMetadata,
      );
    } else if (twammOrderMetadata && twammOrderMetadata?.length !== 0) {
      svgString = await generateDcaOrderNft(
        BigInt(id),
        chainIdParam,
        queries,
        twammOrderMetadata,
      );
    } else if (limitOrderMetadata && limitOrderMetadata.length !== 0) {
      svgString = await generateLimitOrderNft(
        BigInt(id),
        chainIdParam,
        queries,
        limitOrderMetadata,
      );
    } else {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    return c.body(svgString, 200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, immutable",
    });
  },
);
