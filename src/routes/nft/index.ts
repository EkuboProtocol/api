import { IRequest, json, StatusError } from "itty-router";
import { generateDcaOrderNft } from "./generateDcaOrderNft";
import { generateLimitOrderNft } from "./generateLimitOrderNft";
import { generatePositionNft } from "./generatePositionNft";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { NFTMetadata, TokenIdType } from "./format";
import { createQueries } from "../../queries";
import { generatePositionNftMetadata } from "../../shared/metadatas/positions";
import { generateTwapOrderNftMetadata } from "../../shared/metadatas/twap";
import { generateLimitOrderNftMetadata } from "../../shared/metadatas/limit";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";

export class GetNftMetadata extends EkuboAPIRoute {
  static route = "/nft/:chainId/:nftAddress/:id";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Metadata",
    description:
      "Returns the ERC721 metadata for the given token ID, chain ID and NFT contract address",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      nftAddress: Path(AddressType, {
        description: "The address of the NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given position ID",
      },
    },
  };

  async handle(
    { url, params: { id: idStr, chainId: chainIdParam, nftAddress } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);

    const chainId = BigInt(chainIdParam);
    const chainIdString = chainId.toString();

    const queries = await createQueries(env);

    let metadata: NFTMetadata;

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );

    const twammOrderMetadata =
      positionMetadata === null
        ? await queries.getTwammOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;
    const limitOrderMetadata =
      positionMetadata === null && (twammOrderMetadata?.length ?? 0) === 0
        ? await queries.getLimitOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;

    const origin = new URL(url).origin;
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

    return json(metadata, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class GetNftImage extends EkuboAPIRoute {
  static route = "/nft/:chainId/:nftAddress/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Positions"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given position NFT ID",
    parameters: {
      chainId: Path(NumericStringType, {
        description: "Chain ID for which to generate metadata",
      }),
      nftAddress: Path(AddressType, {
        description: "The address of the NFT contract",
      }),
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The position NFT image",
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

    const positionMetadata = await queries.getPositionMetadata(
      chainId,
      BigInt(nftAddress),
      id,
    );
    const twammOrderMetadata =
      positionMetadata === null
        ? await queries.getTwammOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;
    const limitOrderMetadata =
      positionMetadata === null && (twammOrderMetadata?.length ?? 0) === 0
        ? await queries.getLimitOrderMetadata(id, BigInt(nftAddress), chainId)
        : null;

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

    return new Response(svgString, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
}
