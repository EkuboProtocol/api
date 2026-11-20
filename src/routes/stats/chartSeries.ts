import { z } from "@hono/zod-openapi";
import toHex from "../../shared/toHex";
import type { ChartGroupBy, ChartSeriesRow } from "./chartSeriesQueries";

export const CHART_DAYS = 30;
// Groups are ranked by their value over the last two days of the chart.
const RANK_DAYS = 2;
export const MAX_CHART_GROUPS: Record<ChartGroupBy, number> = {
  chain: 8,
  token: 5,
};

export const ChartGroupByType = z.enum(["chain", "token"]).openapi({
  description:
    "What a series is: a network, or a token symbol. Defaults to network without a chainId and to token with one.",
});

const ChartSeriesType = z.object({
  key: z.string().openapi({
    description:
      "The network's chain ID in hex when grouped by network, the token symbol when grouped by token",
  }),
  usd: z.array(z.number()).openapi({
    description: "USD value on each date, at that date's closing prices",
  }),
  amount: z.array(z.number()).nullable().openapi({
    description:
      "Token amount on each date, in whole tokens; null when grouped by network",
  }),
});

export const UsdChartSeriesType = z.object({
  dates: z.array(z.string()).openapi({
    description: "UTC dates of the chart, oldest first, as YYYY-MM-DD",
  }),
  groupBy: ChartGroupByType,
  series: z.array(ChartSeriesType).openapi({
    description:
      "The largest groups by their value over the last two dates, largest first",
  }),
  other: z.array(z.number()).nullable().openapi({
    description:
      "USD value of every group not in series on each date; null when there are none",
  }),
});

export type UsdChartSeries = z.infer<typeof UsdChartSeriesType>;

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The chart's UTC dates, oldest first, ending on the day of `now`. */
export function chartDates(now: number, days = CHART_DAYS) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, index) =>
    isoDate(today - (days - 1 - index) * DAY_MS),
  );
}

export function chartWindow(now: number) {
  const dates = chartDates(now);
  return {
    dates,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    rankFromDate: dates[dates.length - RANK_DAYS],
  };
}

const roundUsd = (value: number) => Math.round(value * 100) / 100;
const roundAmount = (value: number) =>
  value === 0 ? 0 : Number(value.toPrecision(6));

/** Lays the ranked rows of a chart query out as one array per group. */
export function toUsdChartSeries(
  rows: ChartSeriesRow[],
  dates: string[],
  groupBy: ChartGroupBy,
): UsdChartSeries {
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const byGroup = new Map<
    string | null,
    { rank: number; usd: number[]; amount: number[] }
  >();

  for (const row of rows) {
    const index = dateIndex.get(row.date);
    if (index === undefined) continue;
    let group = byGroup.get(row.group_key);
    if (!group) {
      group = {
        rank: Number(row.rank),
        usd: dates.map(() => 0),
        amount: dates.map(() => 0),
      };
      byGroup.set(row.group_key, group);
    }
    group.usd[index] = roundUsd(row.usd);
    group.amount[index] = roundAmount(row.amount ?? 0);
  }

  const other = byGroup.get(null);
  byGroup.delete(null);

  return {
    dates,
    groupBy,
    series: [...byGroup.entries()]
      .sort(([, a], [, b]) => a.rank - b.rank)
      .map(([key, { usd, amount }]) => ({
        key: groupBy === "chain" ? toHex(BigInt(key as string)) : String(key),
        usd,
        amount: groupBy === "token" ? amount : null,
      })),
    other: other ? other.usd : null,
  };
}
