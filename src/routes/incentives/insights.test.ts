import { describe, expect, test } from "bun:test";
import { toIncentiveInsight, type RewardInsightRow } from "./insights";

const END = new Date("2026-10-12T00:00:00.000Z");

const row = (overrides: Partial<RewardInsightRow> = {}): RewardInsightRow => ({
  slug: "btcfi_season",
  computed_through: END,
  contained_periods: 1,
  contained_amount: "441677845968452000000",
  uncertain_periods: 0,
  ...overrides,
});

describe("toIncentiveInsight", () => {
  test("a fully covered window is complete and dated to the frontier", () => {
    expect(toIncentiveInsight(row())).toEqual({
      campaignSlug: "btcfi_season",
      historyWindow: {
        startTime: "2026-10-11T00:00:00.000Z",
        endTime: "2026-10-12T00:00:00.000Z",
        amount: "441677845968452000000",
        status: "complete",
      },
      computedThrough: "2026-10-12T00:00:00.000Z",
    });
  });

  test("a computed window the position earned nothing in is a genuine zero", () => {
    const insight = toIncentiveInsight(
      row({ contained_periods: 3, contained_amount: "0" }),
    );
    expect(insight.historyWindow).toMatchObject({
      amount: "0",
      status: "complete",
    });
  });

  test("an edge-crossing period with rewards makes the amount a subtotal", () => {
    const insight = toIncentiveInsight(
      row({ contained_amount: "5", uncertain_periods: 1 }),
    );
    expect(insight.historyWindow).toMatchObject({
      amount: "5",
      status: "partial",
    });
  });

  test("no period inside the window and an uncertain one is unavailable, not zero", () => {
    const insight = toIncentiveInsight(
      row({
        contained_periods: 0,
        contained_amount: "0",
        uncertain_periods: 1,
      }),
    );
    expect(insight.historyWindow).toEqual({
      startTime: "2026-10-11T00:00:00.000Z",
      endTime: "2026-10-12T00:00:00.000Z",
      amount: null,
      status: "unavailable",
    });
    expect(insight.computedThrough).toBe("2026-10-12T00:00:00.000Z");
  });

  test("nothing computed yet is unavailable with no dates", () => {
    expect(
      toIncentiveInsight(
        row({
          computed_through: null,
          contained_periods: 0,
          contained_amount: "0",
        }),
      ),
    ).toEqual({
      campaignSlug: "btcfi_season",
      historyWindow: {
        startTime: null,
        endTime: null,
        amount: null,
        status: "unavailable",
      },
      computedThrough: null,
    });
  });
});
