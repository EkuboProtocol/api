import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import {
  AddressType,
  DecimalStringType,
  HexStringType,
  NumericStringType,
} from "../../shared/validation/address";

export const RewardType = z
  .object({
    campaignSlug: z.string(),
    amount: DecimalStringType,
  })
  .required({
    campaignSlug: true,
    amount: true,
  });

export type Reward = z.infer<typeof RewardType>;

export const QualifiedRewardType = RewardType.extend({
  locker: AddressType,
  salt: HexStringType,
}).required({ locker: true, salt: true });

export const GetRewardsForPositionResponseType = z
  .object(
    {
      rewards: z.array(RewardType),
    },
    { description: "The list of rewards for a specified position" },
  )
  .required({ rewards: true });

export type QualifiedReward = z.infer<typeof QualifiedRewardType>;

export class ListRewardsForPosition extends EkuboAPIRoute {
  public static route = "/rewards/:locker/:salt";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "Get position rewards",
    description: "Returns the computed rewards for a specified position",
    parameters: {
      locker: Path(AddressType),
      salt: Path(NumericStringType),
      startTime: Query(z.string().datetime({ precision: 0 }), {
        required: false,
        description:
          "Filter to rewards in periods that started at or after this time",
      }),
      endTime: Query(z.string().datetime({ precision: 0 }), {
        required: false,
        description:
          "Filter to rewards in periods that ended at or before this time",
      }),
    },
    responses: {
      "200": {
        description:
          "The computed rewards for each campaign and the specified position",
        schema: GetRewardsForPositionResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const computedRewards = await queries.listComputedRewardsForPosition(
      request.params.locker,
      request.params.salt,
      request.query.startTime as string | undefined,
      request.query.endTime as string | undefined,
    );

    return json(
      {
        rewards: computedRewards.rows.map(
          (cr) =>
            ({
              campaignSlug: cr.slug,
              amount: cr.amount,
            }) satisfies Reward,
        ),
      } satisfies z.infer<typeof GetRewardsForPositionResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=600,must-revalidate",
        },
      },
    );
  }
}
