import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { num } from "starknet";
import { createQueries } from "../../queries";
import { AddressType } from "../../shared/validation/address";

export class ListDrops extends EkuboAPIRoute {
  static route = "/airdrops";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List airdrops",
    description: "Get the list of airdrop contracts",
    parameters: {
      token: Query(AddressType, {
        description: "Filter to airdrops for a specific token",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "List of airdrops that are deployed",
        schema: z
          .array(
            z.object({
              contract_address: AddressType,
              token: AddressType,
              start_date: z.string().datetime(),
              end_date: z.string().datetime(),
            }),
          )
          .openapi({ description: "Array of airdrop contracts" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const drops = await queries.getAllDrops({
      token:
        "token" in request.query ? BigInt(request.query.token as string) : null,
    });

    return json(
      drops.map(({ end_date, start_date, token, contract_address }) => ({
        contract_address: num.toHex(contract_address),
        token: num.toHex(token),
        start_date,
        end_date,
      })),
      {
        headers: {
          "cache-control": `public,max-age=3600`,
        },
      },
    );
  }
}

export class ListAvailableClaimsForUser extends EkuboAPIRoute {
  static route = "/airdrops/:address";
  static schema: OpenAPIRouteSchema = {
    tags: ["Meta"],
    summary: "List airdrops",
    description: "Get the list of airdrop contracts",
    parameters: {
      address: Path(AddressType),
      token: Query(AddressType, {
        description: "Filter to airdrops for a specific token",
        required: false,
      }),
    },
    responses: {
      "200": {
        description: "List of claims that are available for the address",
        schema: z
          .array(
            z.object({
              contract_address: AddressType,
              token: AddressType,
              start_date: z.string().datetime(),
              end_date: z.string().datetime(),
            }),
          )
          .openapi({ description: "Array of airdrop contracts" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const drops = await queries.getClaimsWithProofs({
      forAddress: BigInt(request.params.address as string),
      token:
        "token" in request.query ? BigInt(request.query.token as string) : null,
    });

    const claimee = num.toHex(request.params.address);

    return json(
      drops.map(
        ({
          end_date,
          start_date,
          token,
          contract_address,
          claim_id,
          amount,
          proof,
        }) => ({
          contract_address: num.toHex(contract_address),
          token: num.toHex(token),
          start_date,
          end_date,

          claim: { id: claim_id, amount, claimee },
          proof: proof.map((p) => num.toHex(p)),
        }),
      ),
      {
        headers: {
          "cache-control": `public,max-age=0`,
        },
      },
    );
  }
}
