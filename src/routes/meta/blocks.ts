import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import {
  errorResponses,
  notFoundResponse,
  StatusError,
} from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { createQueries } from "../../queries";
import { ChainIdType } from "../../shared/validation/address";

const BlockInfoType = z.object({
  number: z.number().int(),
  timestamp: z.date(),
});

type BlockInfo = z.infer<typeof BlockInfoType>;

export const GetBlock = defineRoute(
  createRoute({
    method: "get",
    path: "/blocks/{chainId}/{blockTag}",
    tags: ["Meta"],
    summary: "Get block",
    description: "Get information about a particular block ingested by the API",
    operationId: "get_GetBlock",
    request: {
      params: z.object({
        chainId: ChainIdType,
        blockTag: z.coerce
          .number()
          .int()
          .min(160_000)
          .or(z.literal("latest"))
          .describe(
            "The tag of the block to get or the number of a block containing events",
          ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The timestamp of the given block number",
        BlockInfoType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, blockTag } = c.req.valid("param");
    const queries = await createQueries(c.env);

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

    return c.json(response, 200, {
      "cache-control":
        blockTag === "latest"
          ? "public,max-age=5,no-cache"
          : "public,max-age=300,must-revalidate",
    });
  },
);

export const GetClosestBlock = defineRoute(
  createRoute({
    method: "get",
    path: "/blocks/{chainId}/closest",
    tags: ["Meta"],
    summary: "Get the block closest to a given timestamp",
    description:
      "Returns the block whose timestamp is nearest to the provided timestamp",
    operationId: "get_GetClosestBlock",
    request: {
      params: z.object({ chainId: ChainIdType }),
      query: z.object({
        timestamp: z.iso
          .datetime({ precision: 0 })
          .describe(
            "Timestamp to find the closest block for in the ISO string format",
          )
          .openapi({ example: "2025-11-10T00:00:00Z" }),
      }),
    },
    responses: {
      200: jsonResponse(
        "The block closest to the given timestamp",
        BlockInfoType,
      ),
      ...notFoundResponse,
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId } = c.req.valid("param");
    const { timestamp } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const block = await queries.getBlockAtOrAfter(timestamp, chainId);

    if (block === null) {
      throw new StatusError(404, `No block found`);
    }

    const response = {
      number: Number(block.number),
      timestamp: new Date(block.timestamp),
    } satisfies BlockInfo;

    return c.json(response, 200, {
      "cache-control": "public,max-age=300,must-revalidate",
    });
  },
);
