import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import { NFTMetadata, TokenIdType } from "./format";
import { generateDcaOrderNft } from "./generateDcaOrderNft";

export class GetOrderNftMetadata extends EkuboAPIRoute {
  static route = "/orders/nft/:id";
  static schema: OpenAPIRouteSchema = {
    tags: ["Orders"],
    summary: "Get NFT Metadata",
    description: "Returns the ERC721 metadata for the given order token ID",
    parameters: {
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The NFT metadata for the given order ID",
        contentType: "application/json",
      },
    },
  };

  async handle(
    { url, params: { id: idStr } }: IRequest,
    { env }: RequestContext,
  ) {
    const id = BigInt(idStr);

    const queries = await createQueries(env);

    let metadata: NFTMetadata;

    const twammOrderMetadata = await queries.getTwammOrderMetadata(id);

    if (!twammOrderMetadata?.length) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const origin = new URL(url).origin;
    const image = `${origin}/orders/nft/${id}/image.svg`;

    metadata = {
      name: "Ekubo TWAP Order",
      image,
      attributes: [
        {
          trait_type: "minted_tx_hash",
          value: toHex(twammOrderMetadata[0].minted_tx_hash),
        },
        {
          trait_type: "minted_timestamp",
          value: twammOrderMetadata[0].minted_timestamp.getTime().toString(),
        },
      ].concat(
        twammOrderMetadata.flatMap((metadata, ix) => [
          {
            trait_type: `start_time_${ix}`,
            value: (metadata.start_time.getTime() / 1000).toString(),
          },
          {
            trait_type: `end_time_${ix}`,
            value: (metadata.end_time.getTime() / 1000).toString(),
          },
          {
            trait_type: `fee_${ix}`,
            value: toHex(BigInt(metadata.fee)),
          },
          {
            trait_type: `last_update_time_${ix}`,
            value: (metadata.last_update_time.getTime() / 1000).toString(),
          },
          ...(BigInt(metadata.sale_rate0) === 0n &&
          BigInt(metadata.sale_rate1) === 0n
            ? []
            : BigInt(metadata.sale_rate0) > 0n
              ? [
                  {
                    trait_type: `sell_token_${ix}`,
                    value: toHex(BigInt(metadata.token0)),
                  },
                  {
                    trait_type: `buy_token_${ix}`,
                    value: toHex(BigInt(metadata.token1)),
                  },
                ]
              : [
                  {
                    trait_type: `sell_token_${ix}`,
                    value: toHex(BigInt(metadata.token1)),
                  },
                  {
                    trait_type: `buy_token_${ix}`,
                    value: toHex(BigInt(metadata.token0)),
                  },
                ]),
        ]),
      ),
      description: "A TWAP order in Ekubo Protocol",
    };

    return json(metadata, {
      headers: {
        "cache-control": "public,max-age=3600,immutable",
      },
    });
  }
}

export class GetOrderNftImage extends EkuboAPIRoute {
  static route = "/orders/nft/:id/image.svg";

  static schema: OpenAPIRouteSchema = {
    tags: ["Orders"],
    summary: "Get NFT Image",
    description: "Returns the generated art for the given order NFT ID",
    parameters: {
      id: Path(TokenIdType),
    },
    responses: {
      "200": {
        description: "The order NFT image",
        contentType: "application/json",
      },
    },
  };

  async handle({ params: { id: idStr } }: IRequest, { env }: RequestContext) {
    const id = BigInt(idStr);

    const queries = await createQueries(env);

    const twammOrderMetadata = await queries.getTwammOrderMetadata(id);

    if (twammOrderMetadata.length === 0) {
      throw new StatusError(404, `Token ID ${id} not found`);
    }

    const svgString = await generateDcaOrderNft(
      id,
      env.CHAIN_ID,
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
