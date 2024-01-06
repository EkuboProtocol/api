import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { z } from "zod";
import { num } from "starknet";
import { createQueries } from "../../queries";
import { AddressType } from "../../shared/validation/address";

export class GetLeaderboard extends EkuboAPIRoute {
  public static route = "/leaderboard";

  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "List leaderboard",
    description: "Get the first thousand users on the leaderboard",
    parameters: [
      {
        name: "lastMonth",
        location: "query",
        type: z.coerce.boolean(),
      },
    ],
    responses: {
      "200": {
        description:
          "The list of addresses and the number of points earned over the specified period",
        schema: z.object({
          timestamp: z.number(),
          data: z.array(
            z.object({
              collector: z.string(),
              points: z.number().int().min(0),
            })
          ),
        }),
        contentType: "application/json",
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const lastMonth = query?.lastMonth === "true";

    const queries = await createQueries(env);

    const { rows } = await queries.getLeaderboard({
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        timestamp: Date.now(),
        data: rows.map((row) => ({
          collector: num.toHex(row.collector),
          referral_points: Number(row.referral_points),
          points: Number(row.total_points),
        })),
      },
      {
        headers: {
          "cache-control": "public,max-age=150",
        },
      }
    );
  }
}

export class GetLeaderboardForCollector extends EkuboAPIRoute {
  static route = "/leaderboard/:collector/points";
  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "Get points",
    description: "Get the points for a specific collector on the leaderboard",
    parameters: {
      collector: Path(AddressType),
      lastMonth: Query(z.coerce.boolean()),
    },
    responses: {
      "200": {
        description:
          "The list of addresses and the number of points earned over the specified period",
        schema: z.object({
          points: z.number().int().min(0),
        }),
        contentType: "application/json",
      },
    },
  };

  async handle({ params, query }: IRequest, { env }: RequestContext) {
    const lastMonth = query?.lastMonth === "true";
    const collector = BigInt(params.collector);

    const queries = await createQueries(env);

    const { rows } = await queries.getLeaderboard({
      collector,
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        points: Number(rows?.[0]?.total_points ?? 0),
      },
      {
        headers: {
          "cache-control": "public,max-age=150",
        },
      }
    );
  }
}
