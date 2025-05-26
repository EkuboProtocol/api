import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import {
  AddressType,
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
    owner: AddressType,
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
    key: DropKeyType,
    claim: ClaimType,
    proof: z.array(HexStringType),
  })
  .required({ campaign: true, key: true, claim: true, proof: true });

export const ListClaimsResponseType = z
  .object(
    {
      claims: z.array(ClaimEntryType),
    },
    { description: "The list of claims for the given address" },
  )
  .required({ claims: true });

export class ListClaimsForAddress extends EkuboAPIRoute {
  public static route = "/claims/:address";
  static schema: OpenAPIRouteSchema = {
    tags: ["Incentives"],
    summary: "List available claims",
    description: "Returns all the claims available for the address",
    parameters: {
      address: Path(AddressType),
    },
    responses: {
      "200": {
        description: "The list of claims for an address",
        schema: ListClaimsResponseType,
        contentType: "application/json",
      },
    },
  };

  public async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const claims = await queries.listAvailableClaimsForAddress(
      request.params.address,
    );

    return json(
      {
        claims: claims.rows.map(
          (c) =>
            ({
              campaign: c.slug,
              claim: {
                account: toHex(c.address),
                amount: c.amount,
                index: c.index,
              },
              key: {
                owner: toHex(c.owner),
                root: toHex(c.root),
                token: toHex(c.token),
              },
              proof: c.proof.map((p) => toHex(p, 32)),
            }) satisfies z.infer<typeof ClaimEntryType>,
        ),
      } satisfies z.infer<typeof ListClaimsResponseType>,
      {
        headers: {
          "cache-control": "public,max-age=600,must-revalidate",
        },
      },
    );
  }
}
