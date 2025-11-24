import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import {
  AddressType,
  DecimalStringType,
  HexStringType,
} from "../../shared/validation/address";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import { z } from "zod";
import toHex from "../../shared/toHex";

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
    createdTime: z.number().int().min(0),
    description: z.null().or(z.string()),
    calls: z.array(CallType),
    results: z.array(z.array(HexStringType)),
    executed_tx_hash: z.null().or(HexStringType),
  })
  .required({
    id: true,
    description: true,
    calls: true,
    results: true,
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

    const rows = await queries.getProposals();
    return json(
      {
        proposals: rows.map((r) => ({
          id: toHex(BigInt(r.id)),
          description: r.description,
          createdTime: r.created,
          calls:
            r.calls?.map((c) => ({
              to: toHex(BigInt(c.to)),
              selector: toHex(BigInt(c.selector)),
              calldata: c.calldata.map((cd) => toHex(BigInt(cd))),
            })) ?? [],
          results: r.results?.map((p) => p.map((x) => toHex(BigInt(x)))) ?? [],
          executed_tx_hash: r.executed_tx_hash
            ? toHex(r.executed_tx_hash)
            : null,
        })),
      } satisfies ListProposalsResponseType,
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
        schema: ListVotesResponse,
        description: "The list of votes on a specific proposal",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const rows = await queries.getVotesOnProposal({
      proposalId: BigInt(params.proposalId),
    });

    return json(
      {
        votes: rows.map((r) => ({
          time: r.time,
          voter: toHex(BigInt(r.voter)),
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

const ListProposalVotersResponse = z
  .object({
    voters: z.array(
      z
        .object({
          voter: AddressType,
          weight: DecimalStringType,
          vote: z
            .object({
              time: z.number().min(0).int(),
              yea: z.boolean(),
            })
            .or(z.null()),
        })
        .required({
          voter: true,
          weight: true,
          vote: true,
        }),
    ),
  })
  .required({ voters: true });

type ListProposalVotersResponseType = z.infer<
  typeof ListProposalVotersResponse
>;

export class ListProposalVoters extends EkuboAPIRoute {
  static route = "/governance/proposals/:proposalId/voters";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Voters",
    description: "Returns the list of voters for a proposal and their votes",
    parameters: {
      proposalId: Path(HexStringType, {
        required: true,
        description: "The ID of the proposal",
      }),
    },
    responses: {
      "200": {
        schema: ListProposalVotersResponse,
        description:
          "The list of voters and their weights for a specific proposal",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const rows = await queries.getVotersOnProposal({
      proposalId: BigInt(params.proposalId),
    });

    return json(
      {
        voters: rows.map((r) => ({
          voter: toHex(BigInt(r.delegate)),
          weight: r.weight,
          vote:
            r.yea !== null
              ? {
                  yea: r.yea,
                  time: r.vote_time,
                }
              : null,
        })),
      } as ListProposalVotersResponseType,
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
    votingRecord: z.object({
      yea: z.number().int().min(0),
      nay: z.number().int().min(0),
      missed: z.number().int().min(0),
    }),
  })
  .required({
    delegate: true,
    amount: true,
  });

const ListTopDelegatesResponse = z
  .object({
    amountDelegatedTo: DecimalStringType,
    delegates: z.array(DelegateType),
  })
  .required({ amountDelegatedTo: true, delegates: true });

type ListTopDelegatesResponseType = z.infer<typeof ListTopDelegatesResponse>;

export class ListTopDelegates extends EkuboAPIRoute {
  static route = "/governance/delegates";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "List Top Delegates",
    description: "Returns the list of top delegates",
    parameters: {
      pageSize: Query(z.coerce.number().min(1).max(1000).int(), {
        required: false,
      }),
      start: Query(z.coerce.number().min(0).int(), { required: false }),
    },
    responses: {
      "200": {
        schema: ListTopDelegatesResponse,
        description: "The list of top delegates",
        contentType: "application/json",
      },
    },
  };

  async handle({ query }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const { pageSize, start } = query;

    const rows = await queries.getTopDelegates({
      pageSize: Number(pageSize ?? 100),
      start: Number(start ?? 0),
    });

    return json(
      {
        delegates: rows.map((r) => ({
          delegate: toHex(BigInt(r.delegate)),
          amount: r.amount,
          votingRecord: {
            yea: r.yea,
            nay: r.nay,
            missed: r.missed,
          },
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

const GetStakerInfoResponse = z
  .object({
    amountDelegatedTo: DecimalStringType,
    delegates: z.array(DelegateType),
  })
  .required({ amountDelegatedTo: true, delegates: true });
type GetStakerInfoResponseType = z.infer<typeof GetStakerInfoResponse>;

export class GetStakerInfo extends EkuboAPIRoute {
  static route = "/governance/delegates/:address";

  static schema: OpenAPIRouteSchema = {
    tags: ["Governance"],
    summary: "Get Staker Info",
    description:
      "Returns information about a particular staker address: the addresses they have delegated to and the total amount delegated to them",
    parameters: {
      address: Path(AddressType, {
        description: "The address for which to look up staker data",
      }),
    },
    responses: {
      "200": {
        schema: GetStakerInfoResponse,
        description: "Information about the given staker",
        contentType: "application/json",
      },
    },
  };

  async handle({ params }: IRequest, { env }: RequestContext) {
    const queries = await createQueries(env);

    const address = BigInt(params.address);

    const [rows, amountDelegatedTo] = await Promise.all([
      queries.getDelegatesStakedTo({
        staker: address,
      }),
      queries.getAmountDelegatedTo({
        delegate: address,
      }),
    ]);

    return json(
      {
        amountDelegatedTo: amountDelegatedTo.toString(),
        delegates: rows.map((r) => ({
          delegate: toHex(BigInt(r.delegate)),
          amount: r.amount,
        })),
      } as GetStakerInfoResponseType,
      {
        headers: {
          "cache-control": "public, max-age=5",
        },
      },
    );
  }
}
