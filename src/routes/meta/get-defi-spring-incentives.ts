import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier, TokenType } from "./tokens";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import Decimal from "decimal.js-light";
import { PlainPool } from "../quote/nodes/plainPool";
import { MIN_TICK, toSqrtRatio } from "../quote/math/tick";

const DEFAULT_STRK_PRICE = new Decimal("2.0");

const VOLATILITY_BY_PAIR: { [pair: string]: bigint } = {
  "STRK/ETH": 20n,
  "STRK/USDC": 30n,
  "ETH/USDC": 30n,
  "USDC/USDT": 1n,
};

const DEFAULT_VOLATILITY = 50n;

export class GetDefiSpringIncentives extends EkuboAPIRoute {
  public static route = "/defi-spring-incentives";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "DeFi Spring Incentives",
    description: "Get information about the DeFi Spring Incentives program",
    parameters: {},
    responses: {
      "200": {
        description: "The allocation of incentives",
        schema: z.array(
          z.object(
            {
              token0: TokenType,
              token1: TokenType,
              allocations: z.object({
                strkPrice: z.number().min(0),
                pairs: z.array(
                  z.object({
                    date: z.string(),
                    allocation: z.number().min(0),
                    currentApr: z.number().min(0),
                  })
                ),
              }),
            },
            {
              description:
                "Array of token pairs and their respective daily allocations",
            }
          )
        ),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, context: RequestContext, data: any) {
    const queries = await createQueries(context.env);
    const tokens = await getAllTokens(context.env, queries);

    const response = await fetch(
      "https://kx58j6x5me.execute-api.us-east-1.amazonaws.com//starknet/fetchFile?file=qa_strk_grant.json"
    );
    const responseBody = await response.json();

    const pairs: [pairId: string, { date: string; allocation: number }[]][] =
      Object.entries((responseBody as any)?.["Ekubo"]) as any;

    const strkToken = getTokenByIdentifier(tokens, "STRK");
    const usdcToken = getTokenByIdentifier(tokens, "USDC");

    const strkPrice =
      usdcToken && strkToken
        ? (
            await queries.getVolumeWeightedPriceOverPeriod({
              baseToken: BigInt(strkToken.l2_token_address),
              quoteToken: BigInt(usdcToken.l2_token_address),
              minSwapCount: 1,
            })
          )?.price?.mul(
            new Decimal(10).pow(strkToken.decimals - usdcToken.decimals)
          ) ?? DEFAULT_STRK_PRICE
        : DEFAULT_STRK_PRICE;

    const pairData = await Promise.all(
      pairs.map(async ([id, allocations]) => {
        const [tokenAIdentifier, tokenBIdentifier] = id.split("/");
        const tokenA = getTokenByIdentifier(tokens, tokenAIdentifier);
        const tokenB = getTokenByIdentifier(tokens, tokenBIdentifier);

        if (!tokenA || !tokenB) {
          return null;
        }

        const [token0, token1] =
          BigInt(tokenA.l2_token_address) < BigInt(tokenB.l2_token_address)
            ? [tokenA, tokenB]
            : [tokenB, tokenA];

        const [pairLiquidityGraph, pairPrice, price0, price1] =
          await Promise.all([
            // liquidity graph
            queries.getPairLiquidityGraph({
              token0: BigInt(token0.l2_token_address),
              token1: BigInt(token1.l2_token_address),
            }),
            // the pair price
            queries.getVolumeWeightedPriceOverPeriod({
              baseToken: BigInt(token0.l2_token_address),
              quoteToken: BigInt(token1.l2_token_address),
              minSwapCount: 1,
            }),
            // the usdc price of token0
            usdcToken
              ? queries.getVolumeWeightedPriceOverPeriod({
                  baseToken: BigInt(token0.l2_token_address),
                  quoteToken: BigInt(usdcToken.l2_token_address),
                  minSwapCount: 1,
                })
              : null,
            // the usdc price of token1
            usdcToken
              ? queries.getVolumeWeightedPriceOverPeriod({
                  baseToken: BigInt(token1.l2_token_address),
                  quoteToken: BigInt(usdcToken.l2_token_address),
                  minSwapCount: 1,
                })
              : null,
          ]);

        const latestDateAllocation = allocations.reduce<
          typeof allocations[number] | null
        >((memo, value) => {
          if (!memo) return value;
          return new Date(value.date).getTime() > new Date(memo.date).getTime()
            ? value
            : memo;
        }, null);

        const sqrtRatio = BigInt(
          pairPrice?.price
            .sqrt()
            .mul((2n ** 128n).toString())
            .toFixed(0) ?? 0n
        );

        if (sqrtRatio) {
          const sortedTicks = pairLiquidityGraph.map((p) => ({
            tick: Number(p.tick),
            liquidityDelta: BigInt(p.net_liquidity_delta_diff),
          }));
          // find the tick of first index that is greater than current price
          const currentTickIndex =
            sortedTicks.findIndex(
              (p) => toSqrtRatio(Number(p.tick)) > sqrtRatio
            ) - 1;

          const liquidityAtTick = pairLiquidityGraph.reduce(
            (memo, value, ix) =>
              ix <= currentTickIndex
                ? memo + BigInt(value.net_liquidity_delta_diff)
                : memo,
            0n
          );

          const pool = new PlainPool({
            token0: BigInt(token0.l2_token_address),
            token1: BigInt(token1.l2_token_address),
            fee: 0n,
            tickSpacing: 1,
            sqrtRatio: sqrtRatio,
            liquidity: liquidityAtTick,
            tick: Number(
              pairLiquidityGraph[currentTickIndex]?.tick ?? MIN_TICK
            ),
            sortedTicks: pairLiquidityGraph.map((p) => ({
              tick: Number(p.tick),
              liquidityDelta: BigInt(p.net_liquidity_delta_diff),
            })),
          });

          const VOLATILITY_PERCENT: bigint =
            VOLATILITY_BY_PAIR[`${token0.symbol}/${token1.symbol}`] ??
            VOLATILITY_BY_PAIR[`${token1.symbol}/${token0.symbol}`] ??
            DEFAULT_VOLATILITY;

          const { consumedAmount: depth0 } = pool.quote({
            tokenAmount: {
              amount: -0xffffffffffffffffffffffffffffffffn,
              token: BigInt(token0.l2_token_address),
            },
            sqrtRatioLimit: (sqrtRatio * (100n + VOLATILITY_PERCENT)) / 100n,
          });

          const { consumedAmount: depth1 } = pool.quote({
            tokenAmount: {
              amount: -0xffffffffffffffffffffffffffffffffn,
              token: BigInt(token1.l2_token_address),
            },
            sqrtRatioLimit: (sqrtRatio * 100n) / (100n + VOLATILITY_PERCENT),
          });

          const usdcValueDepth0 = price0?.price
            ? new Decimal(-depth0.toString()).mul(price0.price)
            : new Decimal(0);
          const usdcValueDepth1 = price1?.price
            ? new Decimal(-depth1.toString()).mul(price1.price)
            : new Decimal(0);

          const totalValueLockedInRange = usdcValueDepth0
            .plus(usdcValueDepth1)
            .div(new Decimal(10).pow(6));

          const extrapolatedUsdcReward = new Decimal(
            latestDateAllocation?.allocation ?? 0
          )
            .mul(365)
            .mul(strkPrice);

          const currentApr = Number(
            extrapolatedUsdcReward
              .div(totalValueLockedInRange)
              .toSignificantDigits(6)
              .toString()
          );

          return {
            token0,
            token1,
            allocations,
            currentApr,
          };
        }

        return {
          token0,
          token1,
          allocations,
        };
      })
    );

    return json(
      {
        strkPrice: Number(strkPrice.toSignificantDigits(6).toString()),
        pairs: pairData.filter((p) => !!p),
      },
      {
        headers: {
          "cache-control": "public, max-age=3600, must-revalidate",
        },
      }
    );
  }
}
