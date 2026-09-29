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
  NumericStringType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { MAX_U128 } from "@ekubo/sdk";
import { parseOutTokens } from "../../shared/parseOutTokens";
import { createQueries } from "../../queries";

// Sale rate deltas are negative where orders end, so the shared unsigned
// DecimalStringType does not describe them.
const SignedDecimalStringType = z
  .string()
  .describe("A signed decimal number")
  .regex(/^-?\d+e?\d*$/);

const SaleRateDelta = z.object({
  time: z.number().int().min(0),
  token0SaleRateDelta: SignedDecimalStringType,
  token1SaleRateDelta: SignedDecimalStringType,
});

const GetTwammStateResponseType = z.object({
  saleRateDeltas: z.array(SaleRateDelta),
});

type TwammStateResponseType = z.infer<typeof GetTwammStateResponseType>;

const SharedGetPairStateParameters = {
  chainId: ChainIdType,
  tokenA: TokenIdentifierType.openapi({ example: "0x0" }),
  tokenB: TokenIdentifierType.openapi({
    example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  }),
};

export const GetTwammPoolState = defineRoute(
  createRoute({
    method: "get",
    path: "/twap/pools/{chainId}/{coreAddress}/{tokenA}/{tokenB}/{fee}",
    tags: ["TWAP"],
    summary: "Get TWAP pool",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    operationId: "get_GetTwammPoolState",
    request: {
      params: z.object({
        ...SharedGetPairStateParameters,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        fee: NumericStringType.openapi({ example: "" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "The current state of the given TWAMM pool",
        GetTwammStateResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const {
      queries,
      pair: { token0, token1 },
    } = await parseOutTokens(c.env, params, params.chainId);

    const fee = BigInt(params.fee);

    if (fee > MAX_U128) {
      throw new StatusError(400, "Invalid `fee`");
    }

    if (token0 === token1) {
      throw new StatusError(400, "`tokenA` cannot be same as `tokenB`");
    }

    const [stateResults, saleRateDeltas] = await Promise.all([
      queries.getTwammPoolStateByKey({
        chainId: params.chainId,
        coreAddress: BigInt(params.coreAddress),
        token0,
        token1,
        fee,
      }),
      queries.getSaleRateDeltasByKey({
        chainId: params.chainId,
        coreAddress: BigInt(params.coreAddress),
        token0,
        token1,
        fee,
      }),
    ]);

    if (stateResults.length !== 1) {
      throw new StatusError(404, "Pool not found");
    }

    const state = stateResults[0];

    const response = {
      saleRateDeltas: [
        {
          time: state.last_execution_time.getTime() / 1000,
          token0SaleRateDelta: state.token0_sale_rate.toString(),
          token1SaleRateDelta: state.token1_sale_rate.toString(),
        },
      ].concat(
        saleRateDeltas.map((srd) => ({
          time: srd.time.getTime() / 1000,
          token0SaleRateDelta: srd.net_sale_rate_delta0.toString(),
          token1SaleRateDelta: srd.net_sale_rate_delta1.toString(),
        })),
      ),
    } satisfies TwammStateResponseType;

    return c.json(response, 200, {
      "cache-control": "public, max-age=600, must-revalidate",
    });
  },
);

export const GetTwammPoolStateByPoolId = defineRoute(
  createRoute({
    method: "get",
    path: "/twap/pools/{chainId}/{coreAddress}/{poolId}",
    tags: ["TWAP"],
    summary: "Get TWAP pool by pool id",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    operationId: "get_GetTwammPoolStateByPoolId",
    request: {
      params: z.object({
        chainId: ChainIdType,
        coreAddress: AddressType.openapi({ example: "0xabcd" }),
        poolId: NumericStringType.openapi({ example: "1234" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "The current state of the given TWAMM pool",
        GetTwammStateResponseType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const chainId = params.chainId;
    const coreAddress = BigInt(params.coreAddress);
    const poolId = BigInt(params.poolId);
    const queries = await createQueries(c.env);

    const [stateResults, saleRateDeltas] = await Promise.all([
      queries.getTwammPoolStateByKey({
        chainId,
        coreAddress,
        poolId,
      }),
      queries.getSaleRateDeltasByKey({
        chainId,
        coreAddress,
        poolId,
      }),
    ]);

    if (stateResults.length !== 1) {
      throw new StatusError(404, "Pool not found");
    }

    const state = stateResults[0];

    const response = {
      saleRateDeltas: [
        {
          time: state.last_execution_time.getTime() / 1000,
          token0SaleRateDelta: state.token0_sale_rate.toString(),
          token1SaleRateDelta: state.token1_sale_rate.toString(),
        },
      ].concat(
        saleRateDeltas.map((srd) => ({
          time: srd.time.getTime() / 1000,
          token0SaleRateDelta: srd.net_sale_rate_delta0.toString(),
          token1SaleRateDelta: srd.net_sale_rate_delta1.toString(),
        })),
      ),
    } satisfies TwammStateResponseType;

    return c.json(response, 200, {
      "cache-control": "public, max-age=600, must-revalidate",
    });
  },
);

export const GetTwammPairState = defineRoute(
  createRoute({
    method: "get",
    path: "/twap/pair/{chainId}/{tokenA}/{tokenB}",
    tags: ["TWAP"],
    summary: "Get TWAP pair",
    description:
      "Returns the current state of the given TWAMM pair, including the future order expirations",
    operationId: "get_GetTwammPairState",
    request: {
      params: z.object(SharedGetPairStateParameters),
    },
    responses: {
      200: jsonResponse(
        "The current state of the given TWAMM pair",
        GetTwammStateResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const {
      queries,
      pair: { token0, token1 },
    } = await parseOutTokens(c.env, params, params.chainId);

    const [stateResults, saleRateDeltas] = await Promise.all([
      queries.getTwammPoolStateByKey({
        chainId: params.chainId,
        token0,
        token1,
      }),
      queries.getSaleRateDeltasByKey({
        chainId: params.chainId,
        token0,
        token1,
      }),
    ]);

    const response = {
      saleRateDeltas: stateResults
        .filter(
          (s) =>
            BigInt(s.token0_sale_rate) > 0n || BigInt(s.token1_sale_rate) > 0n,
        )
        .map((s) => ({
          time: s.last_execution_time.getTime() / 1000,
          token0SaleRateDelta: s.token0_sale_rate.toString(),
          token1SaleRateDelta: s.token1_sale_rate.toString(),
        }))
        .concat(
          saleRateDeltas.map((srd) => ({
            time: srd.time.getTime() / 1000,
            token0SaleRateDelta: srd.net_sale_rate_delta0.toString(),
            token1SaleRateDelta: srd.net_sale_rate_delta1.toString(),
          })),
        )
        // sort is necessary here because we have state across many pools concatenated to sale rate delta across many pools
        .sort(({ time: t0 }, { time: t1 }) => t0 - t1)
        // this combines any sale rate deltas that are on the same time, which can happen if all the pools are executed up to latest
        .reduce<TwammStateResponseType["saleRateDeltas"]>((memo, current) => {
          const last = memo[memo.length - 1];
          if (!last) return [current];
          if (last.time === current.time) {
            last.token0SaleRateDelta = (
              BigInt(last.token0SaleRateDelta) +
              BigInt(current.token0SaleRateDelta)
            ).toString();

            last.token1SaleRateDelta = (
              BigInt(last.token1SaleRateDelta) +
              BigInt(current.token1SaleRateDelta)
            ).toString();
          } else {
            memo.push(current);
          }
          return memo;
        }, []),
    } satisfies TwammStateResponseType;

    return c.json(response, 200, {
      "cache-control": "public, max-age=600, must-revalidate",
    });
  },
);
