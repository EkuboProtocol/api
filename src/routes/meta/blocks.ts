import { IRequest, json, StatusError } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";

export class GetBlock extends EkuboAPIRoute {
  public static route = "/blocks/:blockTag";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get block",
    description: "Get information about a particular block ingested by the API",
    parameters: {
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
        schema: z.object(
          {
            number: z.number({ description: "The number of the block" }).int(),
            timestamp: z.date({ description: "The timestamp of the block" }),
          },
          { description: "Description of the latest block" },
        ),
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const blockTag =
      request.params.blockTag === "latest"
        ? "latest"
        : Number(request.params.blockTag);
    const block = await (blockTag === "latest"
      ? queries.getLatestBlock()
      : queries.getBlock(blockTag));

    if (block === null) {
      throw new StatusError(404, `Block "${blockTag}" not found`);
    }

    return json(
      {
        number: Number(block.number),
        timestamp: block.timestamp,
      },
      {
        headers: {
          "cache-control":
            blockTag === "latest"
              ? "public,max-age=5,no-cache"
              : "public,max-age=300,must-revalidate",
        },
      },
    );
  }
}

export class GetClosestBlock extends EkuboAPIRoute {
  public static route = "/blocks/closest";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get the block closest to a given timestamp",
    description:
      "Returns the block whose timestamp is nearest to the provided timestamp",
    parameters: {
      timestamp: Query(z.string().datetime({ precision: 0 }), {
        required: true,
        description: "timestamp to find the closest block for",
      }),
    },
    responses: {
      "200": {
        description: "The block closest to the given timestamp",
        schema: z.object(
          {
            number: z.number({ description: "The number of the block" }).int(),
            timestamp: z.date({ description: "The timestamp of the block" }),
          },
          { description: "Description of the latest block" },
        ),
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const block = await queries.getBlockAtOrAfter(
      request.query.timestamp as string,
    );

    if (block === null) {
      throw new StatusError(404, `No block found`);
    }

    return json(
      {
        number: Number(block.number),
        timestamp: block.timestamp,
      },
      {
        headers: {
          "cache-control": "public,max-age=300,must-revalidate",
        },
      },
    );
  }
}
