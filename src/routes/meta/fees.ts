import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";
import { getAllTokens, getTokenByIdentifier } from "./tokens";
import Decimal from "decimal.js-light";

function toReadableAmount(
  value: string | undefined,
  decimals: number,
): number | null {
  if (!value) return null;
  return Math.floor(Number(value)) / 10 ** decimals;
}

export class GetFees extends EkuboAPIRoute {
  public static route = "/fees";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get transaction fees",
    description: "Returns the average transaction fees in ETH",
    responses: {
      "200": {
        description: "The timestamp of the given block number",
        schema: z
          .object(
            {
              dollarPrice: z.number().min(0),
              byToken: z.object({
                ETH: z.number().min(0).or(z.null()),
                STRK: z.number().min(0).or(z.null()),
              }),
            },
            { description: "Information about the current fees on L2" },
          )
          .openapi({
            example: {
              dollarPrice: 0.054626,
              byToken: { ETH: 0.000014868735341665, STRK: 0.02737695235451298 },
            },
          }),
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const averageFeesPaid = await queries.getAverageSwapCostOverLastPeriod({
      since: new Date(Date.now() - 3_600_000),
    });

    const allTokens = await getAllTokens(env, queries);

    const eth = getTokenByIdentifier(allTokens, "ETH");
    const strk = getTokenByIdentifier(allTokens, "STRK");
    const usdc = getTokenByIdentifier(allTokens, "USDC");

    const averageEthPrice = averageFeesPaid.find(
      (afp) => afp.fee_paid_unit === 1,
    );
    const averageStrkPrice = averageFeesPaid.find(
      (afp) => afp.fee_paid_unit === 2,
    );

    const usdcPriceEth =
      usdc && eth
        ? await queries.getVolumeWeightedPrice({
            quoteToken: BigInt(usdc.l2_token_address),
            baseToken: BigInt(eth.l2_token_address),
          })
        : null;

    const usdcPriceStrk =
      usdc && strk
        ? await queries.getVolumeWeightedPrice({
            quoteToken: BigInt(usdc.l2_token_address),
            baseToken: BigInt(strk.l2_token_address),
          })
        : null;

    const totalDollars = (usdcPriceEth?.price ?? new Decimal(0))
      .mul(averageEthPrice?.count ?? 0)
      .mul(averageEthPrice?.avg_fee_paid ?? 0)
      .add(
        (usdcPriceStrk?.price ?? new Decimal(0))
          .mul(averageStrkPrice?.count ?? 0)
          .mul(averageStrkPrice?.avg_fee_paid ?? 0),
      );

    const averageDollarPrice = totalDollars
      .div(
        Math.max(
          Number(averageEthPrice?.count ?? 0) +
            Number(averageStrkPrice?.count ?? 0),
          1,
        ),
      )
      .div(Math.pow(10, usdc?.decimals ?? 0));

    return json(
      {
        dollarPrice: Number(averageDollarPrice.toFixed(6)),
        byToken: {
          ETH: eth
            ? toReadableAmount(averageEthPrice?.avg_fee_paid, eth.decimals)
            : null,
          STRK: strk
            ? toReadableAmount(averageStrkPrice?.avg_fee_paid, strk.decimals)
            : null,
        },
      },
      {
        headers: {
          "cache-control": "public, max-age=3600, must-revalidate",
        },
      },
    );
  }
}
