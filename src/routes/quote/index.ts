import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import {
  DecimalStringType,
  HexStringType,
  NumericStringType,
} from "../../shared/validation/address";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createClientV2 } from "@0x/swap-ts-sdk";
import { Env } from "../../env";
import { ETH_V2_TOKEN_ADDRESS_VALUE } from "../../shared/constants";

let zeroXCachedClient: ReturnType<typeof createClientV2> | null = null;

function getZeroXClient(env: Env) {
  if (!zeroXCachedClient) {
    zeroXCachedClient = createClientV2({ apiKey: env.ZERO_X_API_KEY });
  }
  return zeroXCachedClient;
}

export class Get0xQuote extends EkuboAPIRoute {
  static route = "/quote";

  static schema: OpenAPIRouteSchema = {
    tags: ["Quote"],
    summary: "Get 0x quote",
    description: "Get finalized quote from 0x",
    parameters: {
      buyToken: Query(z.string(), {
        required: true,
        description: "Input token",
      }),
      sellToken: Query(z.coerce.string(), {
        required: true,
        description: "Output token",
      }),
      sellAmount: Query(NumericStringType, { required: true }),
      receiver: Query(HexStringType, { required: true }),
      slippageBps: Query(DecimalStringType, { required: false }),
    },
    responses: {
      "200": {
        description: "The finalized quote from 0x",
        contentType: "application/json",
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    if (env.CHAIN_ID !== "1") {
      throw new StatusError(
        400,
        `0x quotes not supported for chain ID ${env.CHAIN_ID}`,
      );
    }

    const zeroXClient = getZeroXClient(env);

    try {
      const quote = await zeroXClient.swap.allowanceHolder.getQuote.query({
        chainId: 1,
        buyToken:
          BigInt(query.buyToken as string) === ETH_V2_TOKEN_ADDRESS_VALUE
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            : (query.buyToken as string),
        sellToken:
          BigInt(query.sellToken as string) === ETH_V2_TOKEN_ADDRESS_VALUE
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            : (query.sellToken as string),
        sellAmount: query.sellAmount as string,
        taker: query.receiver as string,
        slippageBps: Number(query.slippageBps),
      });

      return json(quote, {
        headers: {
          "cache-control": "public,max-age=10,must-revalidate",
        },
      });
    } catch (error) {
      throw new StatusError(500, `Failed to get quote from 0x: ${error}`);
    }
  }
}
