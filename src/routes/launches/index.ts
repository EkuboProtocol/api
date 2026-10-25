import { createRoute, z } from "@hono/zod-openapi";
import { createQueries } from "../../queries";
import type { Env } from "../../env";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  ErrorResponseType,
  StatusError,
} from "../../shared/errors";
import {
  LaunchList,
  LaunchDetail,
  SwapPage,
  ClaimPage,
  OwnerPage,
} from "./schema";
import {
  AddressType,
  NumericStringType,
} from "../../shared/validation/address";

const chainId = z.coerce
  .bigint()
  .min(0n)
  .max((1n << 63n) - 1n)
  .openapi({ type: "integer", format: "int64" });
// Path segments are folded as integers in the edge cache key, so the pool id
// accepts any hex or decimal form of the same uint256.
const poolId = NumericStringType.refine(
  (value) => BigInt(value) < 1n << 256n,
  "Pool ID out of range",
);
const cursor = z
  .string()
  .regex(/^(0|-?[1-9][0-9]*)$/)
  .transform(BigInt)
  .pipe(
    z
      .bigint()
      .min(-(1n << 63n))
      .max((1n << 63n) - 1n),
  )
  .openapi({ type: "string" });
// Numeric like every address query parameter, so the edge cache key folds it.
const address = AddressType.refine(
  (value) => BigInt(value) < 1n << 160n,
  "Address out of range",
);
const limit = z.coerce.number().int().min(1).max(200).default(50);
const params = z.object({ chainId, poolId });
const page = z.object({ after_event_id: cursor.optional(), limit });
const errors = {
  ...errorResponses,
  ...notFoundResponse,
  503: {
    description: "The indexed head is missing, inconsistent or stale",
    content: { "application/json": { schema: ErrorResponseType } },
  },
};
const response = (schema: z.ZodType) => ({
  description: "Indexed zero-seed launch data",
  content: { "application/json": { schema } },
});
const headers = { "cache-control": "no-store" };
function launchQueries(env: Env) {
  if (!env.PG_CONNECTION_STRING && !env.HYPERDRIVE) {
    throw new StatusError(404, "Launch support is disabled");
  }
  return createQueries(env);
}

export const ListLaunches = defineRoute(
  createRoute({
    method: "get",
    path: "/launches",
    tags: ["Launches"],
    operationId: "get_ListLaunches",
    summary:
      "List supported zero-seed launches across chains, with status, owner and creator filters",
    request: {
      query: z.object({
        // omitted: every chain with launch support
        chainId: chainId.optional(),
        status: z.enum(["all", "trading", "upcoming"]).default("all"),
        // current owner
        owner: address.optional(),
        // owner at creation
        creator: address.optional(),
        order_by: z.enum(["market_cap", "created"]).default("market_cap"),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
        limit,
      }),
    },
    responses: { 200: response(LaunchList), ...errors },
  }),
  async (c) => {
    const query = c.req.valid("query");
    const q = await launchQueries(c.env);
    const data = await q.readZeroSeedList({
      chainId: query.chainId,
      status: query.status,
      orderBy: query.order_by,
      offset: query.offset,
      limit: query.limit,
      creator: query.creator === undefined ? undefined : BigInt(query.creator),
      owner: query.owner === undefined ? undefined : BigInt(query.owner),
    });
    return c.json(data, 200, headers);
  },
);

export const GetLaunch = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}",
    tags: ["Launches"],
    operationId: "get_GetLaunch",
    summary: "Get a supported launch and separate principal/creator ledgers",
    request: { params },
    responses: { 200: response(LaunchDetail), ...errors },
  }),
  async (c) => {
    const { chainId, poolId } = c.req.valid("param");
    const q = await launchQueries(c.env);
    return c.json(
      await q.readZeroSeedDetail(chainId, BigInt(poolId)),
      200,
      headers,
    );
  },
);

export const ListLaunchSwaps = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}/swaps",
    tags: ["Launches"],
    operationId: "get_ListLaunchSwaps",
    summary: "List swaps; forwarding lockers are contracts, not users",
    request: { params, query: page },
    responses: { 200: response(SwapPage), ...errors },
  }),
  async (c) => {
    const { chainId, poolId } = c.req.valid("param");
    const { after_event_id, limit } = c.req.valid("query");
    const q = await launchQueries(c.env);
    return c.json(
      await q.readZeroSeedSwaps({
        chainId,
        poolId: BigInt(poolId),
        cursor: after_event_id,
        limit,
      }),
      200,
      headers,
    );
  },
);

export const ListLaunchClaims = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}/claims",
    tags: ["Launches"],
    operationId: "get_ListLaunchClaims",
    summary:
      "List creator fee claims, one row per claim (extension event, periphery owner and recipient)",
    request: { params, query: page },
    responses: { 200: response(ClaimPage), ...errors },
  }),
  async (c) => {
    const { chainId, poolId } = c.req.valid("param");
    const { after_event_id, limit } = c.req.valid("query");
    const q = await launchQueries(c.env);
    return c.json(
      await q.readZeroSeedClaims({
        chainId,
        poolId: BigInt(poolId),
        cursor: after_event_id,
        limit,
      }),
      200,
      headers,
    );
  },
);

export const ListLaunchOwners = defineRoute(
  createRoute({
    method: "get",
    path: "/launches/{chainId}/{poolId}/owners",
    tags: ["Launches"],
    operationId: "get_ListLaunchOwners",
    summary: "List the creation owner and every later ownership transfer",
    request: { params, query: page },
    responses: { 200: response(OwnerPage), ...errors },
  }),
  async (c) => {
    const { chainId, poolId } = c.req.valid("param");
    const { after_event_id, limit } = c.req.valid("query");
    const q = await launchQueries(c.env);
    return c.json(
      await q.readZeroSeedOwners({
        chainId,
        poolId: BigInt(poolId),
        cursor: after_event_id,
        limit,
      }),
      200,
      headers,
    );
  },
);
