import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";

const CountryResponseType = z.object({
  country: z.string().length(2).nullable(),
});

export const GetCountry = defineRoute(
  createRoute({
    method: "get",
    path: "/country",
    tags: ["Meta"],
    summary: "Get request country",
    description:
      "Returns the Cloudflare country code inferred from the request IP",
    operationId: "get_GetCountry",
    responses: {
      200: jsonResponse(
        "The request country as a two-letter Cloudflare country code",
        CountryResponseType,
      ),
      ...errorResponses,
    },
  }),
  (c) => {
    const cf = c.req.raw.cf;
    const country = typeof cf?.country === "string" ? cf.country : null;

    return c.json({ country }, 200, {
      "cache-control": "private, no-store",
    });
  },
);
