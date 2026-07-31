import { OpenAPIRouteSchema } from "../../shared/openapi";
import { IRequest, json } from "itty-router";
import { z } from "zod";
import { EkuboAPIRoute } from "../../shared/context";

const CountryResponseType = z.object({
  country: z.string().length(2).nullable(),
});

export class GetCountry extends EkuboAPIRoute {
  public static route = "/country";

  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "Get request country",
    description:
      "Returns the Cloudflare country code inferred from the request IP",
    responses: {
      "200": {
        description:
          "The request country as a two-letter Cloudflare country code",
        schema: CountryResponseType,
      },
    },
  };

  public handleRequest(request: IRequest) {
    const country =
      typeof request.cf?.country === "string" ? request.cf.country : null;

    const response = {
      country,
    } satisfies z.infer<typeof CountryResponseType>;

    return json(response, {
      headers: {
        "cache-control": "private, no-store",
      },
    });
  }
}
