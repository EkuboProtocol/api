import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { createQueries } from "../../queries";
import { NFTMetadata, NFTMetadataSchema, TokenIdType } from "./format";
import { generateDcaOrderNft } from "./generateDcaOrderNft";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";
import { generateTwapOrderNftMetadata } from "../../shared/metadatas/twap";

export class GetOrderNftMetadata extends EkuboAPIRoute {
  static route = "/orders/:chainId/:nftAddress/:id";
  static schema: OpenAPIRouteSchema = {
    tags: ["Orders"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given order token ID",
    parameters: {
      chainId: Path(NumericStringType),
      nftAddress: Path(AddressType, {
        description: "The address of the Positions NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given order ID",
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

    if (!twammOrderMetadata?.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(url).origin;
    const image = `${origin}/orders/${chainIdParam}/nft/${id}/image.svg`;

    metadata = generateTwapOrderNftMetadata(twammOrderMetadata, image);

    const response = metadata satisfies NFTMetadata;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class GetOrderNftImage extends EkuboAPIRoute {
  static route = "/orders/:chainId/:nftAddress/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Orders"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given order NFT ID",
    parameters: {
      chainId: Path(NumericStringType),
      nftAddress: Path(AddressType, {
        description: "The address of the Positions NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The order NFT image",
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

    if (twammOrderMetadata.length === 0) {
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
