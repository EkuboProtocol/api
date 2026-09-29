import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { createQueries } from "../../queries";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import toHex from "../../shared/toHex";

export const ClaimType = z
  .object({
    index: z.number().min(0).int(),
    account: AddressType,
    amount: DecimalStringType,
  })
  .required({
    index: true,
    account: true,
    amount: true,
  });

export const DropKeyType = z
  .object({
    owner: AddressType.nullable(),
    token: HexStringType,
    root: HexStringType,
  })
  .required({
    owner: true,
    token: true,
    root: true,
  });

export const ClaimEntryType = z
  .object({
    campaign: z.string().nullable(),
    chainId: HexStringType,
    dropAddress: HexStringType,
    key: DropKeyType,
    claim: ClaimType,
    proof: z.array(HexStringType),
  })
  .required({ campaign: true, key: true, claim: true, proof: true });

export const ListClaimsResponseType = z
  .object({
    claims: z.array(ClaimEntryType),
  })
  .required({ claims: true })
  .describe("The list of claims for the given address");

export const ListClaimsForAddress = defineRoute(
  createRoute({
    method: "get",
    path: "/claims/{address}",
    tags: ["Incentives"],
    summary: "List available claims",
    description: "Returns all the claims available for the address",
    operationId: "get_ListClaimsForAddress",
    request: {
      params: z.object({
        address: AddressType,
      }),
      query: z.object({
        chainId: ChainIdType.optional().describe(
          "Restrict claims to the specified chain ID",
        ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The list of claims for an address",
        ListClaimsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { address } = c.req.valid("param");
    const { chainId } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const claims = await queries.listAvailableClaimsForAddress(
      address,
      chainId ?? null,
    );

    return c.json(
      {
        claims: claims.map(
          (c) =>
            ({
              campaign: c.slug,
              chainId: toHex(c.chain_id),
              dropAddress: toHex(c.drop_address),
              claim: {
                account: toHex(c.address),
                amount: c.amount,
                index: c.index,
              },
              key: {
                owner: c.owner ? toHex(c.owner) : null,
                root: toHex(c.root, 32),
                token: toHex(c.token),
              },
              proof: c.proof.map((p) => toHex(p, 32)),
            }) satisfies z.infer<typeof ClaimEntryType>,
        ),
      } satisfies z.infer<typeof ListClaimsResponseType>,
      200,
      {
        "cache-control": "public,max-age=300,must-revalidate",
      },
    );
  },
);
