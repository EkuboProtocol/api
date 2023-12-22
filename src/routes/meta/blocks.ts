import { error, IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";

export class GetBlock extends EkuboAPIRoute {
  public static route = "/blocks/:number";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get information about a particular block ingested by the API",
    parameters: {
      number: {
        type: z.string(),
        location: "path",
      },
    },
    responses: {
      "200": {
        description: "The timestamp of the given block number",
        schema: z.object(
          {
            number: z.number({ description: "The number of the block" }).int(),
            timestamp: z.date({ description: "The timestamp of the block" }),
          },
          { description: "Array of tokens" }
        ),
        contentType: "application/json",
      },
    },
  };

  public async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    if (params.number !== "latest") {
      return error(501, "Not implemented");
    }

    const block = await queries.getLatestBlock();

    return json(
      {
        number: Number(block.number),
        timestamp: block.timestamp,
      },
      {
        headers: {
          "cache-control": "public, max-age=10, must-revalidate",
        },
      }
    );
  }
}
