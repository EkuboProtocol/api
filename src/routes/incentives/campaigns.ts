import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";
import toHex from "../../shared/toHex";
import {
  AddressType,
  DecimalStringType,
} from "../../shared/validation/address";

export const CampaignType = z
  .object({
    slug: z.string(),
    name: z.string(),
    budget: z.string(),
    rewardToken: AddressType,
    startTime: z.date(),
    endTime: z.date(),
    pairs: z.array(
      z
        .object({
          token0: AddressType,
          token1: AddressType,
          distributed: DecimalStringType,
          total: DecimalStringType,
        })
        .required({
          token0: true,
          token1: true,
          distributed: true,
          total: true,
        }),
    ),
  })
  .required({
    slug: true,
    name: true,
    budget: true,
    rewardToken: true,
    startTime: true,
    endTime: true,
    pairs: true,
  });

export const ListCampaignsResponseType = z
  .object(
    {
      campaigns: z.array(CampaignType),
    },
    { description: "Response for list campaigns endpoint" },
  )
  .required({ campaigns: true });

type Campaign = z.infer<typeof CampaignType>;

export class ListCampaigns extends EkuboAPIRoute {
  public static route = "/campaigns";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "List campaigns",
    description: "List all the liquidity incentive campaigns",
    parameters: {},
    responses: {
      "200": {
        description: "The list of campaigns",
        schema: ListCampaignsResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(_: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const campaigns = await queries.listCampaigns();

    return json(
      {
        campaigns: campaigns.rows.map(
          (c) =>
            ({
              slug: c.slug,
              budget: c.budget,
              startTime: c.start_time,
              endTime: c.end_time,
              name: c.name,
              rewardToken: toHex(c.reward_token),
              pairs: c.rewards.map((p) => ({
                token0: toHex(p.token0),
                token1: toHex(p.token1),
                total: p.total,
                distributed: p.distributed,
              })),
            }) satisfies Campaign,
        ),
      } satisfies z.infer<typeof ListCampaignsResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=3600,must-revalidate",
        },
      },
    );
  }
}
