import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import { z } from "zod";
import { num } from "starknet";

const CallType = z
  .object({
    to: HexStringType,
    selector: HexStringType,
    calldata: z.array(HexStringType),
  })
  .required({ calldata: true, selector: true, to: true });

const ProposalType = z
  .object({
    id: HexStringType,
    description: z.null().or(z.string()),
    calls: z.array(CallType),
    results: z.array(z.array(HexStringType)),
    created_time: z.number().int().min(0),
  })
  .required({
    id: true,
    description: true,
    calls: true,
  });

const ListProposalsResponse = z
  .object({
    proposals: z.array(ProposalType),
  })
  .required({ proposals: true });

type ListProposalsResponseType = z.infer<typeof ListProposalsResponse>;

export class ListProposals extends EkuboAPIRoute {
  static route = "/governance/proposals";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Proposals",
    description: "Returns the list of all proposals",
    parameters: {},
    responses: {
      "200": {
        schema: ListProposalsResponse,
        description: "The list of proposals",
        contentType: "application/json",
      },
    },
  };

  async handle({}: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { rows } = await queries.getProposals();
    return json(
      {
        proposals: rows.map((r) => ({
          id: num.toHex(BigInt(r.id)),
          description: r.description,
          calls:
            r.calls?.map((c) => ({
              to: num.toHex(BigInt(c.to)),
              selector: num.toHex(BigInt(c.selector)),
              calldata: c.calldata.map((cd) => num.toHex(BigInt(cd))),
            })) ?? [],
          results:
            r.results?.map((p) => p.map((x) => num.toHex(BigInt(x)))) ?? [],
          created_time: r.created_time,
        })),
      } as ListProposalsResponseType,
      {
        headers: {
          "cache-control": "public, max-age=1800",
        },
      },
    );
  }
}

const ListVotesResponse = z
  .object({
    votes: z.array(
      z
        .object({
          voter: AddressType,
          weight: DecimalStringType,
          yea: z.boolean(),
        })
        .required({
          voter: true,
          yea: true,
          weight: true,
        }),
    ),
  })
  .required({ votes: true });
type ListVotesResponseType = z.infer<typeof ListVotesResponse>;

export class ListVotesOnProposal extends EkuboAPIRoute {
  static route = "/governance/proposals/:proposalId/votes";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Votes",
    description: "Returns the list of votes on a proposal",
    parameters: {
      proposalId: Path(HexStringType, {
        required: true,
        description: "The ID of the proposal",
      }),
    },
    responses: {
      "200": {
        schema: ListProposalsResponse,
        description: "The list of votes on a specific proposal",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { rows } = await queries.getVotesOnProposal({
      proposalId: BigInt(params.proposalId),
    });

    return json(
      {
        votes: rows.map((r) => ({
          voter: num.toHex(BigInt(r.voter)),
          weight: r.weight,
          yea: r.yea,
        })),
      } as ListVotesResponseType,
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      },
    );
  }
}

const TopDelegateType = z
  .object({
    address: HexStringType,
    delegated_amount: DecimalStringType,
  })
  .required({
    address: true,
    delegated_amount: true,
  });

const ListTopDelegatesResponse = z
  .object({
    delegates: z.array(TopDelegateType),
  })
  .required({ delegates: true });

type ListTopDelegatesResponseType = z.infer<typeof ListTopDelegatesResponse>;

export class ListTopDelegates extends EkuboAPIRoute {
  static route = "/governance/delegates";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Top Delegates",
    description: "Returns the list of top delegates",
    parameters: {},
    responses: {
      "200": {
        schema: ListTopDelegatesResponse,
        description: "The list of top delegates",
        contentType: "application/json",
      },
    },
  };

  async handle({}: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { rows } = await queries.getTopDelegates({ limit: 100 });

    return json(
      {
        delegates: rows.map((r) => ({
          address: num.toHex(BigInt(r.delegate)),
          delegated_amount: r.amount,
        })),
      } as ListTopDelegatesResponseType,
      {
        headers: {
          "cache-control": "public, max-age=3600",
        },
      },
    );
  }
}
