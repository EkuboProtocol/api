import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import {
  AddressType,
  DecimalStringType,
  HexStringType,
  NumericStringType,
} from "../../shared/validation/address";
import { createQueries } from "../../queries";
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

export const ListProposals = defineRoute(
  createRoute({
    method: "get",
    path: "/governance/{chainId}/proposals",
    tags: ["Governance"],
    summary: "List Proposals",
    description: "Returns the list of all proposals",
    operationId: "get_ListProposals",
    request: {
      params: z.object({
        chainId: NumericStringType.describe(
          "Chain ID for which to list proposals",
        ),
      }),
    },
    responses: {
      200: jsonResponse("The list of proposals", ListProposalsResponse),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId: chainIdParam } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const chainId = BigInt(chainIdParam);

    const rows = await queries.getProposals(chainId);
    return c.json(
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
      200,
      {
        "cache-control": "public, max-age=180",
      },
    );
  },
);

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

export const ListVotesOnProposal = defineRoute(
  createRoute({
    method: "get",
    path: "/governance/{chainId}/proposals/{proposalId}/votes",
    tags: ["Governance"],
    summary: "List Votes",
    description: "Returns the list of votes on a proposal",
    operationId: "get_ListVotesOnProposal",
    request: {
      params: z.object({
        chainId: NumericStringType.describe(
          "Chain ID for which to list proposals",
        ),
        proposalId: HexStringType.describe("The ID of the proposal"),
      }),
    },
    responses: {
      200: jsonResponse(
        "The list of votes on a specific proposal",
        ListVotesResponse,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, proposalId } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const rows = await queries.getVotesOnProposal({
      proposalId: BigInt(proposalId),
      chainId: BigInt(chainId),
    });

    return c.json(
      {
        votes: rows.map((r) => ({
          time: r.time,
          voter: toHex(BigInt(r.voter)),
          weight: r.weight,
          yea: r.yea,
        })),
      } satisfies ListVotesResponseType,
      200,
      {
        "cache-control": "public, max-age=600",
      },
    );
  },
);

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

export const ListProposalVoters = defineRoute(
  createRoute({
    method: "get",
    path: "/governance/{chainId}/proposals/{proposalId}/voters",
    tags: ["Governance"],
    summary: "List Voters",
    description: "Returns the list of voters for a proposal and their votes",
    operationId: "get_ListProposalVoters",
    request: {
      params: z.object({
        chainId: NumericStringType.describe(
          "Chain ID for which to list proposals",
        ),
        proposalId: HexStringType.describe("The ID of the proposal"),
      }),
    },
    responses: {
      200: jsonResponse(
        "The list of voters and their weights for a specific proposal",
        ListProposalVotersResponse,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, proposalId } = c.req.valid("param");
    const queries = await createQueries(c.env);

    const rows = await queries.getVotersOnProposal({
      chainId: BigInt(chainId),
      proposalId: BigInt(proposalId),
    });

    return c.json(
      {
        voters: rows.map((r) => ({
          voter: toHex(BigInt(r.delegate)),
          weight: r.weight,
          vote:
            r.yea !== null
              ? {
                  yea: r.yea,
                  // A non-null yea means the governor_voted row joined, and its
                  // block_number references blocks, so vote_time is set too.
                  time: r.vote_time!,
                }
              : null,
        })),
      } satisfies ListProposalVotersResponseType,
      200,
      {
        "cache-control": "public, max-age=600",
      },
    );
  },
);

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
    delegates: z.array(DelegateType),
  })
  .required({ delegates: true });

type ListTopDelegatesResponseType = z.infer<typeof ListTopDelegatesResponse>;

export const ListTopDelegates = defineRoute(
  createRoute({
    method: "get",
    path: "/governance/{chainId}/delegates",
    tags: ["Governance"],
    summary: "List Top Delegates",
    description: "Returns the list of top delegates",
    operationId: "get_ListTopDelegates",
    request: {
      params: z.object({
        chainId: NumericStringType.describe(
          "Chain ID for which to list top delegates",
        ),
      }),
      query: z.object({
        pageSize: z.coerce.number().min(1).max(1000).int().default(100),
        start: z.coerce.number().min(0).int().default(0),
      }),
    },
    responses: {
      200: jsonResponse("The list of top delegates", ListTopDelegatesResponse),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId } = c.req.valid("param");
    const { pageSize, start } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const rows = await queries.getTopDelegates({
      pageSize,
      start,
      chainId: BigInt(chainId),
    });

    return c.json(
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
      } satisfies ListTopDelegatesResponseType,
      200,
      {
        "cache-control": "public, max-age=3600",
      },
    );
  },
);

const GetStakerInfoResponse = z
  .object({
    amountDelegatedTo: DecimalStringType,
    // getDelegatesStakedTo does not compute voting records.
    delegates: z.array(DelegateType.omit({ votingRecord: true })),
  })
  .required({ amountDelegatedTo: true, delegates: true });
type GetStakerInfoResponseType = z.infer<typeof GetStakerInfoResponse>;

export const GetStakerInfo = defineRoute(
  createRoute({
    method: "get",
    path: "/governance/{chainId}/delegates/{address}",
    tags: ["Governance"],
    summary: "Get Staker Info",
    description:
      "Returns information about a particular staker address: the addresses they have delegated to and the total amount delegated to them",
    operationId: "get_GetStakerInfo",
    request: {
      params: z.object({
        chainId: NumericStringType.describe(
          "Chain ID for which to look up staker data",
        ),
        address: AddressType.describe(
          "The address for which to look up staker data",
        ),
      }),
    },
    responses: {
      200: jsonResponse(
        "Information about the given staker",
        GetStakerInfoResponse,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const params = c.req.valid("param");
    const queries = await createQueries(c.env);

    const address = BigInt(params.address);
    const chainId = BigInt(params.chainId);

    const [rows, amountDelegatedTo] = await Promise.all([
      queries.getDelegatesStakedTo({
        chainId,
        staker: address,
      }),
      queries.getAmountDelegatedTo({
        chainId,
        delegate: address,
      }),
    ]);

    return c.json(
      {
        amountDelegatedTo: amountDelegatedTo.toString(),
        delegates: rows.map((r) => ({
          delegate: toHex(BigInt(r.delegate)),
          amount: r.amount,
        })),
      } satisfies GetStakerInfoResponseType,
      200,
      {
        "cache-control": "public, max-age=5",
      },
    );
  },
);
