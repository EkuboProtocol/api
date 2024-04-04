import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { createQueries } from "../../queries";

export class GetNetworkStats extends EkuboAPIRoute {
  public static route = "/network-stats";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get network stats",
    description: "Returns network stats that are useful for Ekubo",
    responses: {
      "200": {
        description: "The times in between blocks in seconds",
        schema: z.object({
          averageBlockTime: z.number().int().min(0),
        }),
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const averageBlockTime = await queries.getAverageBlockTime();

    return json(
      {
        averageBlockTime,
      },
      {
        headers: {
          "cache-control": "public, max-age=3600, must-revalidate",
        },
      },
    );
  }
}
