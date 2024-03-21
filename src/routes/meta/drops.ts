import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { error, IRequest, json } from "itty-router";
import { z } from "zod";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { num } from "starknet";
import { createQueries } from "../../queries";
import {
  AddressType,
  HexStringType,
  NumericType,
} from "../../shared/validation/address";

export class ListDrops extends EkuboAPIRoute {
  static route = "/airdrops";
  static schema: OpenAPIRouteSchema = {
    tags: ["Airdrop"],
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
              funded: z.boolean(),
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
      drops.map(
        ({ end_date, start_date, token, contract_address, funded }) => ({
          contract_address: num.toHex(contract_address),
          token: num.toHex(token),
          start_date,
          end_date,
          funded,
        }),
      ),
      {
        headers: {
          "cache-control": `public,max-age=600`,
        },
      },
    );
  }
}

export class ListAvailableClaimsForUser extends EkuboAPIRoute {
  static route = "/airdrops/:address";
  static schema: OpenAPIRouteSchema = {
    tags: ["Airdrop"],
    summary: "List claims for account",
    description:
      "Get the list of airdrop contracts and related claims for the given account",
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

              claim: z.object({
                id: z.number().int().min(0),
                claimee: AddressType,
                amount: z.number().int().min(0),
              }),
              proof: z.array(HexStringType),

              funded: z.boolean(),
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
          funded,
        }) => ({
          contract_address: num.toHex(contract_address),
          token: num.toHex(token),
          start_date,
          end_date,

          claim: { id: claim_id, amount, claimee },
          proof: proof.map((p) => num.toHex(p)),

          funded,
        }),
      ),
      {
        headers: {
          "cache-control": `public,max-age=600`,
        },
      },
    );
  }
}

export class GetBatchAirdropClaim extends EkuboAPIRoute {
  static route = "/airdrops/:contractAddress/:startingId";
  static schema: OpenAPIRouteSchema = {
    tags: ["Airdrop"],
    summary: "Get batch claim data",
    description:
      "Returns the batch claim data for the given contract and starting ID",
    parameters: {
      contractAddress: Path(AddressType),
      startingId: Path(NumericType),
    },
    responses: {
      "200": {
        description: "List of claims and remaining proof data",
        schema: z
          .object({
            claims: z.array(
              z.object({
                id: z.number().int().min(0),
                claimee: AddressType,
                amount: z.number().int().min(0),
              }),
            ),
            remaining_proof: z.array(HexStringType),
          })
          .openapi({
            description:
              "Array of claim data and the remaining proof starting from the given ID",
          }),
        contentType: "application/json",
      },
    },
  };

  static PROOF_ELEMENTS_SKIPPED = 7;

  async handle(request: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);
    const startingId = Number(request.params.startingId);
    if (startingId % 128 !== 0) {
      return error(400, {
        message: "`startingId` must be multiple of 128",
      });
    }
    const claims = await queries.getClaimsBetween({
      claimContract: BigInt(request.params.contractAddress),
      startingId,
      // this id is inclusive so we add 127
      endingId: startingId + 127,
    });

    if (claims.length === 0) {
      return error(404, {
        message: `No claims for the given address starting from ID ${startingId}`,
      });
    }

    const remainingProof = claims[0].proof.slice(
      GetBatchAirdropClaim.PROOF_ELEMENTS_SKIPPED,
    );

    // check that all the remaining proof elements match
    if (
      !claims.every(
        ({ proof }) =>
          remainingProof.length +
            GetBatchAirdropClaim.PROOF_ELEMENTS_SKIPPED ===
            proof.length &&
          remainingProof.every(
            (element, ix) =>
              element ===
              proof[ix + GetBatchAirdropClaim.PROOF_ELEMENTS_SKIPPED],
          ),
      )
    ) {
      return error(500, "Proof prefix validation failed");
    }

    return json(
      {
        claims: claims.map(({ claim_id, amount, claimee, proof }) => ({
          id: claim_id,
          claimee: num.toHex(BigInt(claimee)),
          amount: num.toHex(BigInt(amount)),
        })),
        remaining_proof: remainingProof.map((x) => num.toHex(BigInt(x))),
      },
      {
        headers: {
          "cache-control": `public,max-age=86400`,
        },
      },
    );
  }
}
