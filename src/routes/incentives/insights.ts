import { z } from "@hono/zod-openapi";
import { DecimalStringType } from "../../shared/validation/address";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export const IncentiveHistoryWindowType = z
  .object({
    startTime: z.iso
      .datetime()
      .nullable()
      .describe("Start of the window, inclusive; null when unavailable"),
    endTime: z.iso
      .datetime()
      .nullable()
      .describe(
        "End of the window, exclusive. Equal to computedThrough; null when unavailable",
      ),
    amount: DecimalStringType.nullable().describe(
      'Reward token base units earned in the window. complete: the exact amount, and "0" is a genuine zero. partial: an exact subtotal of the periods fully inside the window, a lower bound on the window\'s earnings. unavailable: always null',
    ),
    status: z
      .enum(["complete", "partial", "unavailable"])
      .describe(
        "complete: every reward period touching the window is computed and fully inside it, or earned this position nothing. partial: some period crossing the window edge earned this position rewards that cannot be split, so amount excludes them. unavailable: nothing has been computed, or no period fits inside the window",
      ),
  })
  .required({ startTime: true, endTime: true, amount: true, status: true });

export const IncentiveInsightType = z
  .object({
    campaignSlug: z.string(),
    historyWindow: IncentiveHistoryWindowType,
    computedThrough: z.iso
      .datetime()
      .nullable()
      .describe(
        "Rewards for every period of the campaign ending at or before this time are computed. null when no period has been computed",
      ),
  })
  .required({ campaignSlug: true, historyWindow: true, computedThrough: true })
  .describe(
    "The position's earnings over the 24 hours ending at the latest completed and computed reward period of the campaign",
  );

export type IncentiveInsight = z.infer<typeof IncentiveInsightType>;

export interface RewardInsightRow {
  slug: string;
  computed_through: Date | null;
  contained_periods: number;
  contained_amount: string;
  uncertain_periods: number;
}

function status(row: RewardInsightRow) {
  if (row.uncertain_periods === 0) return "complete";
  return row.contained_periods > 0 ? "partial" : "unavailable";
}

export function toIncentiveInsight(row: RewardInsightRow): IncentiveInsight {
  const end = row.computed_through;
  if (end === null) {
    return {
      campaignSlug: row.slug,
      historyWindow: {
        startTime: null,
        endTime: null,
        amount: null,
        status: "unavailable",
      },
      computedThrough: null,
    };
  }
  const windowStatus = status(row);
  return {
    campaignSlug: row.slug,
    historyWindow: {
      startTime: new Date(end.getTime() - WINDOW_MS).toISOString(),
      endTime: end.toISOString(),
      amount: windowStatus === "unavailable" ? null : row.contained_amount,
      status: windowStatus,
    },
    computedThrough: end.toISOString(),
  };
}
