import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ContractCase,
  fetchRoute,
  operations,
  responseSchema,
  stubAllQueriesToThrow,
} from "./contract/harness";
import { UNCOVERED_OPERATIONS } from "./contract/uncovered";
import { auctionsCases } from "./contract/cases/auctions";
import { governanceCases } from "./contract/cases/governance";
import { incentivesCases } from "./contract/cases/incentives";
import { limitCases } from "./contract/cases/limit";
import { metaCases } from "./contract/cases/meta";
import { nftCases } from "./contract/cases/nft";
import { pricesCases } from "./contract/cases/prices";
import { stateCases } from "./contract/cases/state";
import { statsCases } from "./contract/cases/stats";
import { twammCases } from "./contract/cases/twamm";
import { ve33Cases } from "./contract/cases/ve33";
import { launchesCases } from "./contract/cases/launches";

const cases: ContractCase[] = [
  ...metaCases,
  ...statsCases,
  ...pricesCases,
  ...stateCases,
  ...nftCases,
  ...limitCases,
  ...twammCases,
  ...auctionsCases,
  ...governanceCases,
  ...ve33Cases,
  ...launchesCases,
  ...incentivesCases,
];

async function schemaIssues(contractCase: ContractCase) {
  contractCase.stub?.();
  const response = await fetchRoute(contractCase.request);
  expect(response.status).toBe(200);

  const schema = responseSchema(contractCase.operation);
  if (schema === null) {
    expect(contractCase.contentType).toBeDefined();
    expect(response.headers.get("content-type")).toStartWith(
      contractCase.contentType!,
    );
    return [];
  }
  return schema.safeParse(await response.json()).error?.issues ?? [];
}

const named = (list: ContractCase[]) =>
  list.map((c) => [c.name ?? c.request, c] as const);

describe("200 responses match the published OpenAPI schema", () => {
  beforeEach(stubAllQueriesToThrow);
  afterEach(() => mock.restore());

  test.each(named(cases.filter((c) => c.knownDrift === undefined)))(
    "%s",
    async (_, contractCase) => {
      expect(await schemaIssues(contractCase)).toEqual([]);
    },
  );

  // Fixing one of these makes its test fail: drop the case's knownDrift.
  test.each(named(cases.filter((c) => c.knownDrift !== undefined)))(
    "known drift: %s",
    async (_, contractCase) => {
      expect(await schemaIssues(contractCase)).not.toEqual([]);
    },
  );

  test("every operation has a contract case or a recorded reason", () => {
    const covered = new Set(cases.map((c) => c.operation));
    const unaccounted = Object.keys(operations()).filter(
      (operation) =>
        !covered.has(operation) && !(operation in UNCOVERED_OPERATIONS),
    );
    expect(unaccounted).toEqual([]);

    const stale = Object.keys(UNCOVERED_OPERATIONS).filter(
      (operation) => covered.has(operation) || !(operation in operations()),
    );
    expect(stale).toEqual([]);
  });
});
