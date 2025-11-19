import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";
import { ChainIdType } from "../../shared/validation/address";

const BlockInfoType = z.object({
  number: z.number().int(),
  timestamp: z.date(),
});

type BlockInfo = z.infer<typeof BlockInfoType>;

export class GetBlock extends EkuboAPIRoute {
  public static route = "/blocks/:chainId/:blockTag";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get block",
    description: "Get information about a particular block ingested by the API",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      blockTag: Path(
        z.coerce.number().int().min(160_000).or(z.literal("latest")),
        {
          description:
            "The tag of the block to get or the number of a block containing events",
        },
      ),
    },
    responses: {
      "200": {
        description: "The timestamp of the given block number",
        schema: BlockInfoType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const blockTag =
      request.params.blockTag === "latest"
        ? "latest"
        : Number(request.params.blockTag);
    const block = await (blockTag === "latest"
      ? queries.getLatestBlock(chainId)
      : queries.getBlock(blockTag, chainId));

    if (block === null) {
      throw new StatusError(404, `Block "${blockTag}" not found`);
    }

    const response = {
      number: Number(block.number),
      timestamp: new Date(block.timestamp),
    } satisfies BlockInfo;

    return json(response, {
      headers: {
        "cache-control":
          blockTag === "latest"
            ? "public,max-age=5,no-cache"
            : "public,max-age=300,must-revalidate",
      },
    });
  }
}

export class GetClosestBlock extends EkuboAPIRoute {
  public static route = "/blocks/:chainId/closest";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get the block closest to a given timestamp",
    description:
      "Returns the block whose timestamp is nearest to the provided timestamp",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      timestamp: Query(z.string().datetime({ precision: 0 }), {
        required: true,
        example: "2025-11-10T00:00:00Z",
        description:
          "Timestamp to find the closest block for in the ISO string format",
      }),
    },
    responses: {
      "200": {
        description: "The block closest to the given timestamp",
        schema: BlockInfoType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const queries = await createQueries(env);

    const block = await queries.getBlockAtOrAfter(
      request.query.timestamp as string,
      chainId,
    );

    if (block === null) {
      throw new StatusError(404, `No block found`);
    }

    const response = {
      number: Number(block.number),
      timestamp: new Date(block.timestamp),
    } satisfies BlockInfo;

    return json(response, {
      headers: {
        "cache-control": "public,max-age=300,must-revalidate",
      },
    });
  }
}
