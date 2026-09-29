import { ContractCase, stubQuery } from "../harness";
import { OWNER, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

const PROPOSAL_ID = "0x2a";
const DELEGATE_DECIMAL = BigInt(OWNER).toString();
const OTHER_DELEGATE_DECIMAL = "987654321987654321";

export const governanceCases: ContractCase[] = [
  {
    operation: "/governance/{chainId}/proposals",
    request: "/governance/1/proposals",
    stub: () =>
      stubQuery("getProposals", [
        {
          id: "42",
          chain_id: 1n,
          created: 1729252800,
          description: "Raise the protocol fee",
          calls: [
            {
              to: USDC_DECIMAL,
              selector: "2835717307",
              calldata: [WETH_DECIMAL, "1000"],
            },
          ],
          results: [["1"]],
          executed_tx_hash: "123456789",
        },
        {
          id: "41",
          chain_id: 1n,
          created: 1729166400,
          description: null,
          calls: null,
          results: null,
          executed_tx_hash: null,
        },
      ]),
  },
  {
    operation: "/governance/{chainId}/proposals/{proposalId}/votes",
    request: `/governance/1/proposals/${PROPOSAL_ID}/votes`,
    stub: () =>
      stubQuery("getVotesOnProposal", [
        {
          time: 1729253000,
          voter: DELEGATE_DECIMAL,
          weight: "5000000000000000000",
          yea: true,
        },
        {
          time: 1729254000,
          voter: OTHER_DELEGATE_DECIMAL,
          weight: "1000",
          yea: false,
        },
      ]),
  },
  {
    operation: "/governance/{chainId}/proposals/{proposalId}/voters",
    request: `/governance/1/proposals/${PROPOSAL_ID}/voters`,
    stub: () =>
      stubQuery("getVotersOnProposal", [
        {
          delegate: DELEGATE_DECIMAL,
          weight: "5000000000000000000",
          vote_time: 1729253000,
          yea: true,
        },
        {
          delegate: OTHER_DELEGATE_DECIMAL,
          weight: "1000",
          vote_time: null,
          yea: null,
        },
      ]),
  },
  {
    // The handler never sets amountDelegatedTo, which the schema requires.
    name: "/governance/1/delegates",
    knownDrift:
      "ListTopDelegates never sets amountDelegatedTo, which the schema requires.",
    operation: "/governance/{chainId}/delegates",
    request: "/governance/1/delegates?pageSize=10&start=0",
    stub: () =>
      stubQuery("getTopDelegates", [
        {
          delegate: DELEGATE_DECIMAL,
          amount: "5000000000000000000",
          yea: 3,
          nay: 1,
          missed: 0,
        },
      ]),
  },
  {
    // The schema requires votingRecord on each delegate; the handler omits it.
    name: `/governance/1/delegates/${OWNER}`,
    knownDrift:
      "delegates[].votingRecord is required by the shared delegate schema but getDelegatesStakedTo does not return it.",
    operation: "/governance/{chainId}/delegates/{address}",
    request: `/governance/1/delegates/${OWNER}`,
    stub: () => {
      stubQuery("getDelegatesStakedTo", [
        { delegate: OTHER_DELEGATE_DECIMAL, amount: "2000000000000000000" },
      ]);
      stubQuery("getAmountDelegatedTo", 5000000000000000000n);
    },
  },
];
