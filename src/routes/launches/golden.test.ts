import { expect, test } from "bun:test";
import golden from "./fixtures/zero-seed-launch-api-v6.golden.json";
import {
  ClaimPage,
  LaunchDetail,
  LaunchList,
  OwnerPage,
  SCHEMA_VERSION,
  SwapPage,
} from "./schema";

// Written by replay.postgres.test.ts (LAUNCH_GOLDEN_DIR) from the actual
// handlers over the indexer's replayed local chain: a machine-readable
// example of every v6 response for integrators.
const responses = golden as unknown as Record<string, unknown>;

test("every golden response parses with the closed v6 schemas", () => {
  LaunchList.parse(golden.list);
  expect(golden.list.data.length).toBe(7);
  for (const [key, body] of Object.entries(responses)) {
    if (key === "source" || key === "list") continue;
    const schema = key.endsWith("/swaps?limit=200")
      ? SwapPage
      : key.endsWith("/claims?limit=200")
        ? ClaimPage
        : key.endsWith("/owners?limit=200")
          ? OwnerPage
          : LaunchDetail;
    const parsed = schema.parse(body) as { schema_version: string };
    expect(parsed.schema_version).toBe(SCHEMA_VERSION);
  }
});

test("golden: logos, statuses and claims as served", () => {
  expect(golden.l1.logo_url).toBe("https://example.invalid/l1.svg");
  expect(golden.l2.logo_url).toBeNull();
  expect(golden.l4.logo_url).toBeNull();
  expect(golden.l1.creator).not.toBe(golden.l1.owner);
  expect(golden.l1.fee_schedule.evaluated_at).toBe(golden.l1.as_of.block_time);
  for (const label of ["l1", "l2", "l4", "l5", "l6"] as const) {
    const detail = golden[label];
    const claims = responses[`${label}/claims?limit=200`] as {
      data: unknown[];
      totals: unknown;
    };
    expect(claims.data.length).toBe(detail.fee_ledger.claim_count);
    expect(claims.totals).toEqual({
      launch_token: detail.fee_ledger.launch_token.claimed,
      quote_token: detail.fee_ledger.quote_token.claimed,
    });
  }
});
