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

const ZeroXFeeType = z.object({
  amount: z.string(),
  type: z.string(),
  token: z.string(),
});

const ZeroXFeesType = z.object({
  integratorFee: ZeroXFeeType.nullable(),
  zeroExFee: ZeroXFeeType.nullable(),
  gasFee: ZeroXFeeType.nullable(),
});

const ZeroXRouteTokenType = z.object({
  symbol: z.string(),
  address: z.string(),
});

const ZeroXRouteFillType = z.object({
  from: z.string(),
  to: z.string(),
  source: z.string(),
  proportionBps: z.string(),
});

const ZeroXRouteType = z.object({
  tokens: z.array(ZeroXRouteTokenType),
  fills: z.array(ZeroXRouteFillType),
});

const ZeroXIssueType = z.object({
  balance: z
    .object({
      expected: z.string(),
      token: z.string(),
      actual: z.string(),
    })
    .nullable(),
  allowance: z
    .object({
      spender: z.string(),
      actual: z.string(),
    })
    .nullable(),
  simulationIncomplete: z.boolean(),
  invalidSourcesPassed: z.array(z.string()),
});

const ZeroXTokenTaxInfoType = z.object({
  buyTaxBps: z.string().nullable(),
  sellTaxBps: z.string().nullable(),
});

const ZeroXTokenMetadataType = z.object({
  sellToken: ZeroXTokenTaxInfoType,
  buyToken: ZeroXTokenTaxInfoType,
});

const ZeroXBaseQuoteSuccessType = z.object({
  fees: ZeroXFeesType,
  zid: z.string(),
  sellToken: z.string(),
  buyToken: z.string(),
  sellAmount: z.string(),
  minBuyAmount: z.string(),
  buyAmount: z.string(),
  blockNumber: z.string(),
  route: ZeroXRouteType,
  issues: ZeroXIssueType,
  tokenMetadata: ZeroXTokenMetadataType,
  totalNetworkFee: z.string().nullable(),
});

const ZeroXPriceQuoteType = ZeroXBaseQuoteSuccessType.extend({
  liquidityAvailable: z.literal(true),
  gas: z.string().nullable(),
  gasPrice: z.string(),
});

const ZeroXSwapQuoteType = ZeroXBaseQuoteSuccessType.extend({
  liquidityAvailable: z.literal(true),
  transaction: z.object({
    value: z.string(),
    data: z.string(),
    gas: z.string().nullable(),
    to: z.string(),
    gasPrice: z.string(),
  }),
});

const ZeroXNoLiquidityType = z.object({
  zid: z.string(),
  liquidityAvailable: z.literal(false),
});

const ZeroXQuoteResponseType = z.union([
  ZeroXPriceQuoteType,
  ZeroXSwapQuoteType,
  ZeroXNoLiquidityType,
]);

type ZeroXQuoteResponse = z.infer<typeof ZeroXQuoteResponseType>;

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
        description: "Target chain ID for the quote",
      }),
    },
    responses: {
      "200": {
        description: "The finalized quote from 0x",
        contentType: "application/json",
        schema: ZeroXQuoteResponseType,
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const requestedChainId =
      typeof query.chainId === "string" ? BigInt(query.chainId) : 1n;

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

      const response = quote satisfies ZeroXQuoteResponse;

      return json(response, {
        headers: {
          "cache-control": "public,max-age=10,must-revalidate",
        },
      });
    } catch (error) {
      throw new StatusError(500, `Failed to get quote from 0x: ${error}`);
    }
  }
}
