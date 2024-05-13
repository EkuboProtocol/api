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
    proposer: AddressType,
    description: z.null().or(z.string()),
    calls: z.array(CallType),
    results: z.array(z.array(HexStringType)),
    created_time: z.number().int().min(0),
    executed_time: z.number().int().min(0).or(z.null()),
    canceled_time: z.number().int().min(0).or(z.null()),
  })
  .required({
    id: true,
    description: true,
    calls: true,
    proposer: true,
    results: true,
    created_time: true,
    executed_time: true,
    canceled_time: true,
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
          proposer: num.toHex(BigInt(r.proposer)),
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
          executed_time: r.executed_time,
          canceled_time: r.canceled_time,
        })),
      } as ListProposalsResponseType,
      {
        headers: {
          "cache-control": "public, max-age=180",
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
          time: z.number().min(0).int(),
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
          time: r.time,
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

const DelegateType = z
  .object({
    delegate: AddressType,
    amount: DecimalStringType,
  })
  .required({
    delegate: true,
    amount: true,
  });

const ListTopDelegatesResponse = z
  .object({
    delegates: z.array(DelegateType),
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
          delegate: num.toHex(BigInt(r.delegate)),
          amount: r.amount,
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

export class ListStakedDelegates extends EkuboAPIRoute {
  static route = "/governance/delegates/:staker";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Staked Amounts",
    description:
      "Returns the list of delegates that the staker has delegated to",
    parameters: {
      staker: Path(AddressType, {
        description: "The staker for which to look up delegates",
      }),
    },
    responses: {
      "200": {
        schema: ListTopDelegatesResponse,
        description: "The list of delegates that the staker has staked to",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { rows } = await queries.getDelegatesStakedTo({
      staker: BigInt(params.staker),
    });

    return json(
      {
        delegates: rows.map((r) => ({
          delegate: num.toHex(BigInt(r.delegate)),
          amount: r.amount,
        })),
      } as ListTopDelegatesResponseType,
      {
        headers: {
          "cache-control": "public, max-age=30",
        },
      },
    );
  }
}
