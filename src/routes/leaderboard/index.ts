import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../_shared/context";
import { Env } from "../../env";
import { FEE_TOKEN_ADDRESS } from "../meta/tokens";
import { z } from "zod";
import { constants, Contract, num, RpcProvider } from "starknet";
import POSITIONS_ABI from "./positions-abi.json";
import { Queries } from "../../queries";

export const POSITIONS_CONTRACT_ADDRESS: {
  [chainId in constants.StarknetChainId]: bigint;
} = {
  ["0x534e5f4d41494e"]:
    0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067n,
  ["0x534e5f474f45524c49"]:
    0x073fa8432bf59f8ed535f29acfd89a7020758bda7be509e00dfed8a9fde12ddcn,
};

export class GetLeaderboard extends EkuboAPIRoute {
  public static route = "/leaderboard";

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

  async handle({ query }: IRequest, { env, client }: RequestContext) {
    const lastMonth = query?.lastMonth === "true";

    const dao = new Queries(client);

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

let provider: RpcProvider | null = null;

function getProvider(env: Env): RpcProvider {
  return (
    provider ??
    (provider = new RpcProvider({
      nodeUrl: env.RPC_URL,
      chainId: env.STARKNET_CHAIN_ID,
    }))
  );
}

export class GetLeaderboardDump extends EkuboAPIRoute {
  public static route = "/leaderboard/dump";
  static schema: OpenAPIRouteSchema = {
    tags: ["Leaderboard"],
    summary: "Dump the entire state of the leaderboard",
    responses: {
      "200": {
        description: "The entire contents of the leaderboard",
        contentType: "application/json",
      },
    },
  };
  async handle({ query }: IRequest, { env, client }: RequestContext) {
    if (query.key !== "wip") {
      return error(501, "Not implemented");
    }

    const provider = getProvider(env);

    const contract = new Contract(
      POSITIONS_ABI,
      num.toHex(POSITIONS_CONTRACT_ADDRESS[env.STARKNET_CHAIN_ID]),
      provider
    );

    const queries = new Queries(client);

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

  async handle({ params, query }: IRequest, { env, client }: RequestContext) {
    const lastMonth = query?.lastMonth === "true";
    let collector: bigint;
    try {
      collector = BigInt(params.collector);
    } catch (e) {
      return error(400, "Invalid collector address");
    }

    const dao = new Queries(client);

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
