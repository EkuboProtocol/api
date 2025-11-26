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
  ChainIdType,
  DecimalStringType,
  NumericStringType,
} from "../../shared/validation/address";

export const RewardType = z
  .object({
    campaignSlug: z.string(),
    amount: DecimalStringType,
    pending: DecimalStringType,
  })
  .required({
    campaignSlug: true,
    amount: true,
    pending: true,
  });

export type Reward = z.infer<typeof RewardType>;

export const GetRewardsForPositionResponseType = z
  .object(
    {
      rewards: z.array(RewardType),
    },
    { description: "The list of rewards for a specified position" },
  )
  .required({ rewards: true });

export class ListRewardsForLocker extends EkuboAPIRoute {
  public static route = "/rewards/:chainId/:locker/:salt";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "Get position rewards",
    description: "Returns the computed rewards for a specified position",
    parameters: {
      chainId: Path(ChainIdType),
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
    const chainId = ChainIdType.parse(request.params.chainId);
    const queries = await createQueries(env);

    const computedRewards = await queries.listComputedRewardsForPosition(
      chainId,
      request.params.locker,
      request.params.salt,
      request.query.startTime as string | undefined,
      request.query.endTime as string | undefined,
    );

    return json(
      {
        rewards: computedRewards.map(
          (cr) =>
            ({
              campaignSlug: cr.slug,
              amount: cr.amount,
              pending: cr.pending,
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
