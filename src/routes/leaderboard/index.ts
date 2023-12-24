import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { FEE_TOKEN_ADDRESS } from "../meta/tokens";
import { z } from "zod";
import { Contract, num } from "starknet";
import POSITIONS_ABI from "../../constants/abis/positions.json";
import { createQueries } from "../../queries";
import { getProvider } from "../../shared/getProvider";
import { POSITIONS_CONTRACT_ADDRESS } from "../../constants/addresses";
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
      feeTokenAddress: FEE_TOKEN_ADDRESS[env.STARKNET_CHAIN_ID],
      collectedAfter: lastMonth
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : undefined,
    });

    return json(
      {
        timestamp: Date.now(),
        data: rows.map((row) => ({
          collector: num.toHex(row.collector),
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

export class GetLeaderboardDump extends EkuboAPIRoute {
  public static route = "/leaderboard/dump";

  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "Dump leaderboard",
    description:
      "Dump the entire leaderboard to a JSON file, including uncollected fees",
    responses: {
      "200": {
        description: "The entire contents of the leaderboard",
        contentType: "application/json",
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    if (query.key !== "wip") {
      return error(501, "Not implemented");
    }

    const provider = getProvider(env);

    const contract = new Contract(
      POSITIONS_ABI,
      num.toHex(POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID]),
      provider
    );

    const queries = await createQueries(env);

    await queries.withinTransaction(async () => {
      const tokens = await queries.getAllActiveTokenIdsWithPoolKeys();

      // todo: write all the current tokens info into temp tables and then query the temp tables and add up all the points
      // todo: make sure the block at which the query happens is the same as the latest database

      await contract.call("get_tokens_info", [[]]);
    });

    return json(
      {},
      {
        headers: {
          "cache-control":
            "public,max-age=86400,stale-while-revalidate=3600,stale-if-error=180",
          "content-disposition": 'attachment; filename="dump.json"',
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

    const dao = await createQueries(env);

    const { rows } = await dao.getLeaderboard({
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
