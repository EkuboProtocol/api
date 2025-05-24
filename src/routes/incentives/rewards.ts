import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";
import {
  AddressType,
  DecimalStringType,
} from "../../shared/validation/address";
import toHex from "../../shared/toHex";

export const RewardsEntryType = z
  .object({
    token0: AddressType,
    token1: AddressType,
    rewardAmount0: DecimalStringType,
    rewardAmount1: DecimalStringType,
    startTime: z.date(),
    endTime: z.date(),
  })
  .required({
    startTime: true,
    endTime: true,
    rewardAmount0: true,
    rewardAmount1: true,
  });

export const ListRewardsResponseType = z
  .object(
    {
      periods: z.array(RewardsEntryType),
    },
    { description: "Response for list campaign schedule endpoint" },
  )
  .required({ periods: true });

type RewardsEntry = z.infer<typeof RewardsEntryType>;

export class ListRewardPeriods extends EkuboAPIRoute {
  public static route = "/campaigns/:slug/rewards";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "List rewards",
    description:
      "Returns a list of rewards that are distributed for a campaign at a given timestamp",
    parameters: {
      slug: Path(z.string(), {
        description: "The slug of the campaign being queried",
      }),
      activeAt: Query(z.string().datetime({ precision: 0 }), {
        description:
          "Filter to reward periods that are active at the given time",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The available rewards for the given campaign",
        schema: ListRewardsResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const periods = await queries.listRewardsPeriods(
      request.params.slug,
      request.query.activeAt as string,
    );

    return json(
      {
        periods: periods.rows.map(
          (crp) =>
            ({
              token0: toHex(crp.token0),
              token1: toHex(crp.token1),
              startTime: crp.start_time,
              endTime: crp.end_time,
              rewardAmount0: crp.token0_reward_amount,
              rewardAmount1: crp.token1_reward_amount,
            }) satisfies RewardsEntry,
        ),
      } satisfies z.infer<typeof ListRewardsResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=600,must-revalidate",
        },
      },
    );
  }
}
