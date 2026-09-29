import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
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
  .object({
    rewards: z.array(RewardType),
  })
  .required({ rewards: true })
  .describe("The list of rewards for a specified position");

export const ListRewardsForLocker = defineRoute(
  createRoute({
    method: "get",
    path: "/rewards/{chainId}/{locker}/{salt}",
    tags: ["Incentives"],
    summary: "Get position rewards",
    description: "Returns the computed rewards for a specified position",
    operationId: "get_ListRewardsForLocker",
    request: {
      params: z.object({
        chainId: ChainIdType,
        locker: AddressType,
        salt: NumericStringType,
      }),
      query: z.object({
        startTime: z.iso
          .datetime({ precision: 0 })
          .optional()
          .describe(
            "Filter to rewards in periods that started at or after this time",
          ),
        endTime: z.iso
          .datetime({ precision: 0 })
          .optional()
          .describe(
            "Filter to rewards in periods that ended at or before this time",
          ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The computed rewards for each campaign and the specified position",
        GetRewardsForPositionResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, locker, salt } = c.req.valid("param");
    const { startTime, endTime } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const computedRewards = await queries.listComputedRewardsForPosition(
      chainId,
      locker,
      salt,
      startTime,
      endTime,
    );

    return c.json(
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
      200,
      {
        "cache-control": "public,max-age=600,must-revalidate",
      },
    );
  },
);
