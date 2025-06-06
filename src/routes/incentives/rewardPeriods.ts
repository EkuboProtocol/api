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
    realizedVolatility: z.number().min(0),
  })
  .required({
    token0: true,
    token1: true,
    startTime: true,
    endTime: true,
    rewardAmount0: true,
    rewardAmount1: true,
  });

export const ListRewardsForCampaignResponseType = z
  .object(
    {
      periods: z.array(RewardsEntryType),
    },
    { description: "Response for list rewards endpoint" },
  )
  .required({ periods: true });

type RewardsEntry = z.infer<typeof RewardsEntryType>;

export class ListRewardPeriodsForCampaign extends EkuboAPIRoute {
  public static route = "/campaigns/:slug/reward-periods";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "List rewards for campaign",
    description:
      "Returns a list of rewards that are distributed for a campaign at a specified timestamp",
    parameters: {
      slug: Path(z.string(), {
        description: "The slug of the campaign being queried",
      }),
      activeAt: Query(z.string().datetime({ precision: 0 }), {
        description:
          "Filter to reward periods that are active at the specified time",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The available rewards for the specified campaign",
        schema: ListRewardsForCampaignResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const periods = await queries.listRewardsPeriodsForCampaign(
      request.params.slug,
      request.query.activeAt as string | undefined,
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
              realizedVolatility: crp.realized_volatility,
            }) satisfies RewardsEntry,
        ),
      } satisfies z.infer<typeof ListRewardsForCampaignResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=600,must-revalidate",
        },
      },
    );
  }
}

const QualifiedRewardsEntryType = RewardsEntryType.extend({
  slug: z.string(),
}).required({ slug: true });

export const ListRewardsResponseType = z
  .object(
    {
      periods: z.array(QualifiedRewardsEntryType),
    },
    { description: "Response for list rewards endpoint" },
  )
  .required({ periods: true });

type QualifiedRewardsEntry = z.infer<typeof QualifiedRewardsEntryType>;

export class ListRewardPeriods extends EkuboAPIRoute {
  public static route = "/reward-periods";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "List all rewards",
    description:
      "Returns a list of all reward periods that are being distributed at a specified timestamp",
    parameters: {
      activeAt: Query(z.string().datetime({ precision: 0 }), {
        description:
          "Filter to reward periods that are active at the specified time",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "The available rewards at the specified datetime",
        schema: ListRewardsResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const periods = await queries.listRewardPeriods(
      request.query.activeAt as string | undefined,
    );

    return json(
      {
        periods: periods.rows.map(
          (crp) =>
            ({
              slug: crp.slug,
              token0: toHex(crp.token0),
              token1: toHex(crp.token1),
              startTime: crp.start_time,
              endTime: crp.end_time,
              rewardAmount0: crp.token0_reward_amount,
              rewardAmount1: crp.token1_reward_amount,
              realizedVolatility: crp.realized_volatility,
            }) satisfies QualifiedRewardsEntry,
        ),
      } satisfies z.infer<typeof ListRewardsForCampaignResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=600,must-revalidate",
        },
      },
    );
  }
}
