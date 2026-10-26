import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { AddressType, ChainIdType } from "../../shared/validation/address";
import { createQueries } from "../../queries";
import { jsonResponse } from "../../shared/openapi";
import { errorResponses, StatusError } from "../../shared/errors";

const DEFAULT_NET_FLOW_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_NET_FLOW_DURATION_SECONDS = 24 * 60 * 60;
const MAX_NET_FLOW_DURATION_SECONDS = 30 * 86_400;
export const MAX_NET_FLOW_BUCKETS = 1_000;

const TokenNetFlowPointType = z.object({
  start: z.union([z.string(), z.date()]).describe("Bucket start time"),
  bought: z
    .string()
    .describe(
      "Raw token units that left Ekubo pools to traders in the bucket, as a decimal string",
    ),
  sold: z
    .string()
    .describe(
      "Raw token units traders paid into Ekubo pools in the bucket, as a decimal string",
    ),
  swap_count: z
    .number()
    .int()
    .describe("Number of swaps in the bucket that touched the token"),
});

const GetTokenNetFlowResponseType = z.object({
  timestamp: z.number().int().describe("Response time, unix seconds"),
  start: z.number().int().describe("Start of the window, unix seconds"),
  end: z.number().int().describe("End of the window, unix seconds"),
  interval: z.number().int(),
  data: z.array(TokenNetFlowPointType),
});

export function netFlowWindow(
  nowMilliseconds: number,
  intervalSeconds: number,
  durationSeconds: number,
): { start: Date; end: Date } {
  if (durationSeconds / intervalSeconds > MAX_NET_FLOW_BUCKETS) {
    throw new StatusError(
      400,
      `Interval must produce at most ${MAX_NET_FLOW_BUCKETS} buckets`,
    );
  }

  const endSeconds = Math.floor(nowMilliseconds / 1_000);
  return {
    start: new Date((endSeconds - durationSeconds) * 1_000),
    end: new Date(endSeconds * 1_000),
  };
}

export const GetTokenNetFlow = defineRoute(
  createRoute({
    method: "get",
    path: "/tokens/{chainId}/{tokenAddress}/net-flow",
    tags: ["Prices"],
    summary: "Get token net buy and sell flow",
    description:
      "Returns how much of a token traders bought from and sold into Ekubo pools in each interval, across every pool on the chain that holds the token, including TWAMM and limit order execution. " +
      "Buckets use the same boundaries as the token price history and only buckets with at least one swap are returned; an unknown token returns no buckets. " +
      "A multi-hop route that passes through the token adds the same amount to both bought and sold, so the net flow is exact while the gross amounts include that routing.",
    operationId: "get_GetTokenNetFlow",
    request: {
      params: z.object({
        chainId: ChainIdType,
        tokenAddress: AddressType,
      }),
      query: z.object({
        interval: z.coerce
          .number()
          .int()
          .min(60)
          .max(86_400)
          .optional()
          .describe("Bucket size in seconds")
          .default(DEFAULT_NET_FLOW_INTERVAL_SECONDS),
        duration: z.coerce
          .number()
          .int()
          .min(3_600)
          .max(MAX_NET_FLOW_DURATION_SECONDS)
          .optional()
          .describe(
            `History duration in seconds ending now, up to 30 days and at most ${MAX_NET_FLOW_BUCKETS} intervals`,
          )
          .default(DEFAULT_NET_FLOW_DURATION_SECONDS),
      }),
    },
    responses: {
      200: jsonResponse(
        "The token's bought and sold amounts per interval",
        GetTokenNetFlowResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, tokenAddress } = c.req.valid("param");
    const { interval: intervalSeconds, duration: durationSeconds } =
      c.req.valid("query");
    const now = Date.now();
    const { start, end } = netFlowWindow(now, intervalSeconds, durationSeconds);

    const queries = await createQueries(c.env);
    const data = await queries.getTokenNetFlow({
      chainId,
      tokenAddress: BigInt(tokenAddress),
      start,
      end,
      intervalSeconds,
    });

    const response = {
      timestamp: Math.floor(now / 1_000),
      start: start.getTime() / 1_000,
      end: end.getTime() / 1_000,
      interval: intervalSeconds,
      data,
    } satisfies z.infer<typeof GetTokenNetFlowResponseType>;

    return c.json(response, 200, {
      "cache-control": `public, max-age=${Math.ceil(intervalSeconds / 4)}, must-revalidate`,
    });
  },
);
