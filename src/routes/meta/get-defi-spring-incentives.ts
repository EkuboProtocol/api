import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { getAllTokens, getTokenByIdentifier } from "./tokens";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import Decimal from "decimal.js-light";
import { PlainPool } from "../quote/nodes/plainPool";
import { MIN_TICK, toSqrtRatio } from "../quote/math/tick";
import { AddressType, NumericType } from "../../shared/validation/address";
import { DateType } from "../../shared/validation/date";

const DEFAULT_STRK_PRICE = new Decimal("2.0");

interface OBLIncentiveResponse {
  Ekubo: {
    [pairId: string]: {
      date: string;
      allocation: number;
      thirty_day_realized_volatility: number;
      tvl_usd?: number;
      apr?: number;
    }[];
  };
}

async function getOBLIncentiveDataForEkubo(): Promise<
  OBLIncentiveResponse["Ekubo"]
> {
  const response = await fetch(
    "https://kx58j6x5me.execute-api.us-east-1.amazonaws.com/starknet/fetchFile?file=strk_grant.json",
  );

  const responseText = await response.text();
  const parsed = JSON.parse(responseText.replaceAll(/NaN/g, "0"));
  const result = parsed as OBLIncentiveResponse;
  if (!result.Ekubo) throw new Error("Missing Ekubo key in OBL response data");
  return result.Ekubo;
}

function addIncentivesToData(
  map: OBLIncentiveResponse["Ekubo"],
  { pairId, date, amount }: { pairId: string; date: string; amount: number },
) {
  const [tokenA, tokenB] = pairId.split("/");
  const pairDailyData =
    map[`${tokenA}/${tokenB}`] ?? map[`${tokenB}/${tokenA}`];

  if (!pairDailyData) {
    map[`${tokenA}/${tokenB}`] = [
      {
        date,
        allocation: amount,
        // we use the value 1 as a fallback
        thirty_day_realized_volatility: 1,
      },
    ];
  } else {
    const dayData = pairDailyData.find((d) => d.date === date);
    if (dayData) {
      dayData.allocation += amount;
    } else {
      pairDailyData.push({
        date,
        allocation: amount,
        thirty_day_realized_volatility: 1,
      });
    }
  }
}

const SPLITS_BY_DATE_RANGE: {
  start: Date;
  end: Date;
  splits: { pairId: string; weight: number }[];
}[] = [
  {
    start: new Date("2024-03-21"),
    end: new Date("2024-04-04"),
    splits: [
      {
        pairId: "ZEND/ETH",
        weight: 1,
      },
      {
        pairId: "LORDS/ETH",
        weight: 10,
      },
      {
        pairId: "rETH/ETH",
        weight: 1,
      },
      {
        pairId: "ETH/USDT",
        weight: 3,
      },
    ],
  },
];

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
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, context: RequestContext) {
    const queries = await createQueries(context.env);
    const tokens = await getAllTokens(context.env, queries);

    const incentiveData = await getOBLIncentiveDataForEkubo();

    {
      // manipulate the response object, replacing discretionary with our own allocations
      const discretionary = incentiveData.Discretionary;
      delete incentiveData.Discretionary;

      if (discretionary) {
        discretionary.forEach(({ date, allocation }) => {
          const d = new Date(date);
          const matching = SPLITS_BY_DATE_RANGE.find(
            (s) => d >= s.start && d < s.end,
          );

          if (!matching) return;

          const totalWeight = matching.splits.reduce((m, v) => m + v.weight, 0);

          matching.splits.forEach(({ pairId, weight }) => {
            addIncentivesToData(incentiveData, {
              pairId,
              date,
              amount:
                Math.floor((allocation * weight * 1000) / totalWeight) / 1000,
            });
          });
        });
      }
    }

    const pairs = Object.entries(incentiveData);

    const totalStrk = pairs.reduce(
      (memo, [key, value]) =>
        memo + value.reduce((memo, { allocation }) => allocation + memo, 0),
      0,
    );

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
            new Decimal(10).pow(strkToken.decimals - usdcToken.decimals),
          ) ?? DEFAULT_STRK_PRICE
        : DEFAULT_STRK_PRICE;

    const filteredPairs = pairs
      .map(([id, data]) => {
        if (id === "Discretionary") return null;

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

        return {
          ...data,
          dailyAllocations: data,
          token0,
          token1,
        };
      })
      .filter((x): x is Exclude<typeof x, null> => !!x);

    const currentVolatilityData = await queries.getVolatilityData({
      fromDate: new Date(`${new Date().toISOString().split("T")[0]}T00:00:00Z`),
      numDays: 30,
      pairs: filteredPairs.map((p) => ({
        token0: BigInt(p.token0.l2_token_address),
        token1: BigInt(p.token1.l2_token_address),
      })),
    });

    const pairData = await Promise.all(
      filteredPairs.map(async ({ token0, token1, dailyAllocations }) => {
        let volatilityInTicks = currentVolatilityData.find(
          (vd) =>
            BigInt(vd.token0) === BigInt(token0.l2_token_address) &&
            BigInt(vd.token1) === BigInt(token1.l2_token_address),
        )?.volatility_in_ticks;

        if (!volatilityInTicks) {
          volatilityInTicks = Math.round(
            new Decimal(
              dailyAllocations[dailyAllocations.length - 1]
                ?.thirty_day_realized_volatility ?? 1,
            )
              .exp()
              .log("1.000001")
              .toNumber(),
          );
        }

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

        const latestDateAllocation = dailyAllocations.reduce<
          (typeof dailyAllocations)[number] | null
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
            .toFixed(0) ?? 0n,
        );

        const allocations = dailyAllocations.map(
          ({ allocation, date, thirty_day_realized_volatility }) => ({
            date,
            allocation,
            thirty_day_realized_volatility,
          }),
        );

        if (sqrtRatio) {
          const sortedTicks = pairLiquidityGraph.map((p) => ({
            tick: Number(p.tick),
            liquidityDelta: BigInt(p.net_liquidity_delta_diff),
          }));
          // find the tick of first index that is greater than current price
          const currentTickIndex =
            sortedTicks.findIndex(
              (p) => toSqrtRatio(Number(p.tick)) > sqrtRatio,
            ) - 1;

          const liquidityAtTick = pairLiquidityGraph.reduce(
            (memo, value, ix) =>
              ix <= currentTickIndex
                ? memo + BigInt(value.net_liquidity_delta_diff)
                : memo,
            0n,
          );

          const pool = new PlainPool({
            token0: BigInt(token0.l2_token_address),
            token1: BigInt(token1.l2_token_address),
            fee: 0n,
            tickSpacing: 1,
            sqrtRatio: sqrtRatio,
            liquidity: liquidityAtTick,
            tick: Number(
              pairLiquidityGraph[currentTickIndex]?.tick ?? MIN_TICK,
            ),
            sortedTicks: pairLiquidityGraph.map((p) => ({
              tick: Number(p.tick),
              liquidityDelta: BigInt(p.net_liquidity_delta_diff),
            })),
          });

          const { consumedAmount: depth0 } = pool.quote({
            tokenAmount: {
              amount: -0xffffffffffffffffffffffffffffffffn,
              token: BigInt(token0.l2_token_address),
            },
            sqrtRatioLimit: toSqrtRatio(pool.tick + volatilityInTicks * 2),
          });

          const { consumedAmount: depth1 } = pool.quote({
            tokenAmount: {
              amount: -0xffffffffffffffffffffffffffffffffn,
              token: BigInt(token1.l2_token_address),
            },
            sqrtRatioLimit: toSqrtRatio(pool.tick - volatilityInTicks * 2),
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
            latestDateAllocation?.allocation ?? 0,
          )
            .mul(365)
            .mul(strkPrice)
            .mul(
              totalValueLockedInRange.div(
                latestDateAllocation?.tvl_usd ?? totalValueLockedInRange,
              ),
            );

          const currentApr = Number(
            extrapolatedUsdcReward
              .div(totalValueLockedInRange)
              .toSignificantDigits(6)
              .toString(),
          );

          return {
            token0,
            token1,
            allocations,
            currentApr,
            volatilityInTicks,
          };
        }

        return {
          token0,
          token1,
          allocations,
        };
      }),
    );

    return json(
      {
        strkPrice: Number(strkPrice.toSignificantDigits(6).toString()),
        totalStrk,
        pairs: pairData.filter((p) => !!p),
      },
      {
        headers: {
          "cache-control": "public, max-age=3600, must-revalidate",
        },
      },
    );
  }
}

export class GetDefiSpringIncentivesForAddressAndDates extends EkuboAPIRoute {
  public static route = "/defi-spring-incentives/:address/:start/:end";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get address incentives",
    description:
      "Get the total incentives for the given address over the period",
    parameters: {
      address: Path(AddressType, {
        description: "The address for which to get the incentive allocations",
      }),
      start: Path(DateType, {
        description: "The first date for which to query, inclusive",
      }),
      end: Path(DateType, {
        description: "The last date for which to query, exclusive",
      }),
    },
    responses: {
      "200": {
        description:
          "The allocation of incentives for each token ID held or burned by the address",
        schema: z
          .map(
            NumericType,
            z.object({
              total: z.number(),
              per_day: z.array(
                z.object({ date: DateType, amount: z.number().min(0) }),
              ),
            }),
            {
              description: "Describes the allocation for a particular token",
            },
          )
          .openapi({
            type: "object",
            example: {
              [1]: {
                total: 1234.56,
                per_day: [{ date: "2024-02-22", amount: 1234.56 }],
              },
            } as any,
          }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, context: RequestContext) {
    const queries = await createQueries(context.env);

    const result = await queries.getAllocations({
      owner: BigInt(request.params.address),
      start: new Date(`${request.params.start}T00:00:00Z`),
      end: new Date(`${request.params.end}T00:00:00Z`),
    });

    return json(
      result.reduce<{
        [token_id: number]: {
          total: number;
          per_day: {
            date: string;
            amount: number;
          }[];
        };
      }>((memo, r) => {
        const forToken =
          memo[Number(r.token_id)] ??
          (memo[Number(r.token_id)] = { total: 0, per_day: [] });
        forToken.total += Number(r.incentives);
        forToken.per_day.push({
          date: new Date(r.day).toISOString().split("T")[0],
          amount: Number(r.incentives),
        });
        return memo;
      }, {}),
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
    );
  }
}

export class GetDefiSpringIncentivesForTokenId extends EkuboAPIRoute {
  public static route = "/defi-spring-incentives/by-token/:tokenId";

  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get token incentives",
    description:
      "Get the total incentives for the given token ID over the period",
    parameters: {
      tokenId: Path(NumericType, {
        description: "The token ID for which to get the incentive allocations",
      }),
    },
    responses: {
      "200": {
        description: "The allocation of incentives for the given token ID",
        schema: z.object(
          {
            total: z.number(),
            per_day: z.array(
              z.object({ date: DateType, amount: z.number().min(0) }),
            ),
          },
          {
            description: "Describes the allocation for a particular token",
          },
        ),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, context: RequestContext) {
    const queries = await createQueries(context.env);

    const result = await queries.getAllocationsForToken({
      tokenId: BigInt(request.params.tokenId),
    });

    return json(
      result.reduce<{
        total: number;
        per_day: {
          date: string;
          amount: number;
        }[];
      }>(
        (memo, r) => {
          memo.total += Number(r.incentives);
          memo.per_day.push({
            date: new Date(r.day).toISOString().split("T")[0],
            amount: Number(r.incentives),
          });
          return memo;
        },
        {
          total: 0,
          per_day: [],
        },
      ),
      {
        headers: {
          "cache-control": "public, max-age=600, must-revalidate",
        },
      },
    );
  }
}
