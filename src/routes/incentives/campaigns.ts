import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import {
  AddressType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import { ChainIdType } from "../../shared/validation/address";

export const CampaignType = z
  .object({
    slug: z.string(),
    chain_id: HexStringType,
    coreAddress: HexStringType,
    allowedLockers: z.array(HexStringType).or(z.null()),
    name: z.string(),
    rewardToken: AddressType,
    startTime: z.date(),
    endTime: z.date().nullable(),
    // Null once the campaign has ended.
    nextDropTime: z.date().nullable(),
    allowedExtensions: z.array(AddressType),
    pairs: z.array(
      z
        .object({
          token0: AddressType,
          token1: AddressType,
          depth_percent: z.number().min(0).nullable(),
          depth0: DecimalStringType.nullable(),
          depth1: DecimalStringType.nullable(),
          distributed: DecimalStringType,
          scheduled: DecimalStringType,
          daily_rewards: DecimalStringType,
          daily_rewards_token0: DecimalStringType,
          daily_rewards_token1: DecimalStringType,
          realized_volatility: z.number().min(0).nullable(),
        })
        .required({
          token0: true,
          token1: true,
          depth0: true,
          depth1: true,
          distributed: true,
          scheduled: true,
          daily_rewards: true,
          daily_rewards_token0: true,
          daily_rewards_token1: true,
          realized_volatility: true,
        }),
    ),
  })
  .required({
    slug: true,
    coreAddress: true,
    allowedLockers: true,
    name: true,
    rewardToken: true,
    startTime: true,
    endTime: true,
    nextDropTime: true,
    pairs: true,
  });

export const ListCampaignsResponseType = z
  .object({
    campaigns: z.array(CampaignType),
  })
  .required({ campaigns: true })
  .describe("Response for list campaigns endpoint");

type Campaign = z.infer<typeof CampaignType>;

export const ListCampaigns = defineRoute(
  createRoute({
    method: "get",
    path: "/campaigns",
    tags: ["Incentives"],
    summary: "List campaigns",
    description: "List all the liquidity incentive campaigns",
    operationId: "get_ListCampaigns",
    request: {
      query: z.object({
        chainId: ChainIdType.optional().describe(
          "Restrict campaigns to the specified chain ID",
        ),
      }),
    },
    responses: {
      200: jsonResponse("The list of campaigns", ListCampaignsResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const campaigns = await queries.listCampaigns(chainId ?? null);
    return c.json(
      {
        campaigns: campaigns.map((c) => {
          return {
            slug: c.slug,
            chain_id: toHex(c.chain_id),
            coreAddress: toHex(c.core_address),
            allowedLockers: c.allowed_lockers?.map(toHex) ?? null,
            startTime: c.start_time,
            endTime: c.end_time,
            name: c.name,
            rewardToken: toHex(c.reward_token),
            nextDropTime: c.next_drop_time,
            allowedExtensions: c.allowed_extensions.map((a) => toHex(a)) ?? [],
            pairs: c.rewards.map((p) => ({
              token0: toHex(p.token0),
              token1: toHex(p.token1),
              depth_percent: p.depth_percent,
              depth0: p.depth0,
              depth1: p.depth1,
              scheduled: p.scheduled,
              distributed: p.distributed,
              daily_rewards: p.daily_rewards,
              daily_rewards_token0: p.daily_rewards_token0,
              daily_rewards_token1: p.daily_rewards_token1,
              realized_volatility: p.realized_volatility,
            })),
          } satisfies Campaign;
        }),
      } satisfies z.infer<typeof ListCampaignsResponseType>,
      200,
      {
        "cache-control": "public,max-age=300,must-revalidate",
      },
    );
  },
);
