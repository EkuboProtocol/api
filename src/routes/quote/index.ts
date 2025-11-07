import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import {
  AddressType,
  ChainIdType,
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
import { ETH_V2_TOKEN_ADDRESS_VALUE } from "../../shared/constants";

let zeroXCachedClient: ReturnType<typeof createClientV2> | null = null;

function getZeroXClient(env: { ZERO_X_API_KEY: string }) {
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
      buyToken: Query(AddressType, {
        required: true,
        description: "Input token",
      }),
      sellToken: Query(AddressType, {
        required: true,
        description: "Output token",
      }),
      sellAmount: Query(NumericStringType, { required: true }),
      receiver: Query(HexStringType, { required: false }),
      slippageBps: Query(DecimalStringType, { required: false }),
      chainId: Query(ChainIdType, {
        required: false,
        description: "Target chain ID for the quote (only 1 is supported)",
      }),
    },
    responses: {
      "200": {
        description: "The finalized quote from 0x",
        contentType: "application/json",
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const requestedChainId =
      typeof query.chainId === "string" ? BigInt(query.chainId) : 1n;
    if (requestedChainId !== 1n) {
      throw new StatusError(
        400,
        `0x quotes not supported for chain ID ${requestedChainId.toString()}`,
      );
    }

    const zeroXClient = getZeroXClient(env);

    try {
      const commonArgs = {
        chainId: Number(requestedChainId),
        buyToken:
          BigInt(query.buyToken as string) === ETH_V2_TOKEN_ADDRESS_VALUE
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            : (query.buyToken as string),
        sellToken:
          BigInt(query.sellToken as string) === ETH_V2_TOKEN_ADDRESS_VALUE
            ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
            : (query.sellToken as string),
        sellAmount: query.sellAmount as string,
        slippageBps: Number(query.slippageBps),
      };

      const quote = await (query.receiver !== undefined
        ? zeroXClient.swap.allowanceHolder.getQuote.query({
            ...commonArgs,
            taker: query.receiver as string,
          })
        : zeroXClient.swap.allowanceHolder.getPrice.query(commonArgs));

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
