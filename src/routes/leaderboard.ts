import {
  OpenAPIRoute,
  OpenAPIRouteSchema,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { RequestContext } from "./context";
import { Env } from "../env";
import { FEE_TOKEN_ADDRESS } from "../tokens";
import { createQueries } from "../createQueries";
import { z } from "zod";
import { POSITIONS_CONTRACT_ADDRESS } from "../constants";
import { numericToHex } from "../format";

export class GetLeaderboard extends OpenAPIRoute<IRequest, RequestContext> {
  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "Get the current ranking leaderboard",
    parameters: [
      {
        name: "lastMonth",
        location: "query",
        type: z.coerce.boolean(),
      },
    ],
    request: {},
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

  async handle({ query }: IRequest, env: Env, context: ExecutionContext) {
    const lastMonth = query?.lastMonth === "true";

    const dao = await createQueries(env);

    const positionsContractAddress =
      POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID];

    const { rows } = await dao.getLeaderboard({
      positionsContractAddress,
      feeTokenAddress: FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID],
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        timestamp: Date.now(),
        data: rows.map((row) => ({
          collector: numericToHex(row.collector),
          points: Number(row.points),
        })),
      },
      {
        headers: {
          "cache-control":
            "public,max-age=3600,stale-while-revalidate=3600,stale-if-error=180",
        },
      }
    );
  }
}

export class GetLeaderboardForCollector extends OpenAPIRoute<
  IRequest,
  RequestContext
> {
  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "Get the number of points for a specific collector address",
    parameters: [
      {
        name: "lastMonth",
        location: "query",
        type: z.coerce.boolean(),
      },
      {
        name: "collector",
        location: "path",
        type: z.string(),
      },
    ],
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

  async handle(
    { params, query }: IRequest,
    env: Env,
    context: ExecutionContext
  ) {
    const lastMonth = query?.lastMonth === "true";
    let collector: bigint;
    try {
      collector = BigInt(params.collector);
    } catch (e) {
      return error(400, "Invalid collector address");
    }

    const dao = await createQueries(env);

    const positionsContractAddress =
      POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID];

    const { rows } = await dao.getLeaderboard({
      positionsContractAddress,
      feeTokenAddress: FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID],
      collector,
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        points: Number(rows?.[0]?.points ?? 0),
      },
      {
        headers: {
          "cache-control":
            "public,max-age=3600,stale-while-revalidate=3600,stale-if-error=180",
        },
      }
    );
  }
}
