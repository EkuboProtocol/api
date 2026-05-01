import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  NumericStringType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { z } from "zod";
import { MAX_U128 } from "@ekubo/sdk";
import { parseOutTokens } from "../../shared/parseOutTokens";
import { createQueries } from "../../queries";

const SaleRateDelta = z.object({
  time: z.number().int().min(0),
  token0SaleRateDelta: DecimalStringType,
  token1SaleRateDelta: DecimalStringType,
});

const GetTwammStateResponseType = z.object({
  saleRateDeltas: z.array(SaleRateDelta),
});

type TwammStateResponseType = z.infer<typeof GetTwammStateResponseType>;

const SharedGetPairStateParameters = {
  chainId: Path(ChainIdType, { required: true }),
  tokenA: Path(TokenIdentifierType, { required: true, example: "0x0" }),
  tokenB: Path(TokenIdentifierType, {
    required: true,
    example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  }),
};

export class GetTwammPoolState extends EkuboAPIRoute {
  static route = "/twap/pools/:chainId/:coreAddress/:tokenA/:tokenB/:fee";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pool",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    parameters: {
      ...SharedGetPairStateParameters,
      coreAddress: Path(AddressType, { required: true, example: "0xabcd" }),
      fee: Path(NumericStringType, { required: true, example: "" }),
    },
    responses: {
      "200": {
        description: "The current state of the given TWAMM pool",
        schema: GetTwammStateResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const {
      queries,
      pair: { token0, token1 },
    } = await parseOutTokens(
      env,
      request.params,
      BigInt(request.params.chainId),
    );

    const fee = BigInt(request.params.fee);

    if (fee > MAX_U128) {
      throw new StatusError(400, "Invalid `fee`");
    }

    if (token0 === token1) {
      throw new StatusError(400, "`tokenA` cannot be same as `tokenB`");
    }

    const [stateResults, saleRateDeltas] = await Promise.all([
      queries.getTwammPoolStateByKey({
        chainId: BigInt(request.params.chainId),
        coreAddress: BigInt(request.params.coreAddress),
        token0,
        token1,
        fee,
      }),
      queries.getSaleRateDeltasByKey({
        chainId: BigInt(request.params.chainId),
        coreAddress: BigInt(request.params.coreAddress),
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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600, must-revalidate",
      },
    });
  }
}

export class GetTwammPoolStateByPoolId extends EkuboAPIRoute {
  static route = "/twap/pools/:chainId/:coreAddress/:poolId";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pool by pool id",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { required: true, example: "0xabcd" }),
      poolId: Path(NumericStringType, { required: true, example: "1234" }),
    },
    responses: {
      "200": {
        description: "The current state of the given TWAMM pool",
        schema: GetTwammStateResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const coreAddress = BigInt(request.params.coreAddress);
    const poolId = BigInt(request.params.poolId);
    const queries = await createQueries(env);

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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600, must-revalidate",
      },
    });
  }
}

export class GetTwammPairState extends EkuboAPIRoute {
  static route = "/twap/pair/:chainId/:tokenA/:tokenB";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pair",
    description:
      "Returns the current state of the given TWAMM pair, including the future order expirations",
    parameters: SharedGetPairStateParameters,
    responses: {
      "200": {
        description: "The current state of the given TWAMM pair",
        schema: GetTwammStateResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const {
      queries,
      pair: { token0, token1 },
    } = await parseOutTokens(
      env,
      request.params,
      BigInt(request.params.chainId),
    );

    const [stateResults, saleRateDeltas] = await Promise.all([
      queries.getTwammPoolStateByKey({
        chainId: BigInt(request.params.chainId),
        token0,
        token1,
      }),
      queries.getSaleRateDeltasByKey({
        chainId: BigInt(request.params.chainId),
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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600, must-revalidate",
      },
    });
  }
}
