import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  DecimalStringType,
  NumericType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import { z } from "zod";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";
import { MAX_U128 } from "@ekubo/sdk";

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
  tokenA: Path(TokenIdentifierType, { required: true, example: "ETH" }),
  tokenB: Path(TokenIdentifierType, { required: true, example: "USDC" }),
};

export class GetTwammPoolState extends EkuboAPIRoute {
  static route = "/twap/pools/:tokenA/:tokenB/:fee";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pool",
    description:
      "Returns the current state of the given TWAMM pool, including the future order expirations",
    parameters: {
      ...SharedGetPairStateParameters,
      fee: Path(NumericType, { required: true, example: "" }),
    },
    responses: {
      "200": {
        description: "The current state of the given TWAMM pool",
        contentType: "application/json",
        schema: GetTwammStateResponseType,
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const tokens = await getAllTokens(env, queries);

    const tokenA = getTokenByIdentifier(tokens, params.tokenA);
    if (!tokenA) {
      throw new StatusError(404, "`tokenA` not found");
    }
    const tokenB = getTokenByIdentifier(tokens, params.tokenB);
    if (!tokenB) {
      throw new StatusError(404, "`tokenB` not found");
    }

    const fee = BigInt(params.fee);

    if (fee > MAX_U128) {
      throw new StatusError(400, "Invalid `fee`");
    }

    const [token0, token1] =
      BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
        ? [BigInt(tokenA.l2_token_address), BigInt(tokenB.l2_token_address)]
        : [BigInt(tokenB.l2_token_address), BigInt(tokenA.l2_token_address)];

    if (token0 === token1) {
      throw new StatusError(400, "`tokenA` cannot be same as `tokenB`");
    }

    const [{ rows: stateResults }, { rows: saleRateDeltas }] =
      await queries.withinTransaction(() =>
        Promise.all([
          queries.getTwammPoolStateByKey({
            token0,
            token1,
            fee,
          }),
          queries.getSaleRateDeltasByKey({
            token0,
            token1,
            fee,
          }),
        ]),
      );

    if (stateResults.length !== 1) {
      throw new StatusError(404, "Pool not found");
    }

    const state = stateResults[0];

    return json(
      <TwammStateResponseType>{
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
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
    );
  }
}

export class GetTwammPairState extends EkuboAPIRoute {
  static route = "/twap/pair/:tokenA/:tokenB";

  static schema: OpenAPIRouteSchema = {
    tags: ["TWAP"],
    summary: "Get TWAP pair",
    description:
      "Returns the current state of the given TWAMM pair, including the future order expirations",
    parameters: SharedGetPairStateParameters,
    responses: {
      "200": {
        description: "The current state of the given TWAMM pair",
        contentType: "application/json",
        schema: GetTwammStateResponseType,
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const tokens = await getAllTokens(env, queries);

    const tokenA = getTokenByIdentifier(tokens, params.tokenA);
    if (!tokenA) {
      throw new StatusError(404, "`tokenA` not found");
    }
    const tokenB = getTokenByIdentifier(tokens, params.tokenB);
    if (!tokenB) {
      throw new StatusError(404, "`tokenB` not found");
    }

    const [token0, token1] =
      BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
        ? [BigInt(tokenA.l2_token_address), BigInt(tokenB.l2_token_address)]
        : [BigInt(tokenB.l2_token_address), BigInt(tokenA.l2_token_address)];

    if (token0 === token1) {
      throw new StatusError(400, "`tokenA` cannot be same as `tokenB`");
    }

    const [{ rows: stateResults }, { rows: saleRateDeltas }] =
      await queries.withinTransaction(() =>
        Promise.all([
          queries.getTwammPoolStateByKey({
            token0,
            token1,
          }),
          queries.getSaleRateDeltasByKey({
            token0,
            token1,
          }),
        ]),
      );

    return json(
      <TwammStateResponseType>{
        saleRateDeltas: stateResults
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
      },
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
    );
  }
}
