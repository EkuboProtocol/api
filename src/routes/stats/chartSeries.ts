import { z } from "@hono/zod-openapi";
import toHex from "../../shared/toHex";
import { HexStringType } from "../../shared/validation/address";
import type { ChartSeriesRow } from "./chartSeriesQueries";

export const CHART_DAYS = 30;
// Symbols are ranked by their value over the last two days of the chart.
const RANK_DAYS = 2;
/** Token symbols with their own series in each network. */
export const MAX_CHART_SYMBOLS = 5;

const TokenSeriesType = z.object({
  symbol: z.string(),
  usd: z.array(z.number()).openapi({
    description: "USD value on each date, at that date's closing prices",
  }),
  amount: z.array(z.number()).openapi({
    description: "Token amount on each date, in whole tokens",
  }),
});

const NetworkSeriesType = z.object({
  chain_id: HexStringType,
  usd: z.array(z.number()).openapi({
    description:
      "USD value of the network on each date, at that date's closing prices",
  }),
  tokens: z.array(TokenSeriesType).openapi({
    description:
      "The network's five largest token symbols by their value over the last two dates, largest first",
  }),
  other: z.array(z.number()).nullable().openapi({
    description:
      "USD value of the network's other symbols on each date; null when there are none",
  }),
});

export const UsdChartType = z.object({
  dates: z.array(z.string()).openapi({
    description: "UTC dates of the chart, oldest first, as YYYY-MM-DD",
  }),
  networks: z.array(NetworkSeriesType).openapi({
    description: "One entry per network, sorted by chain_id",
  }),
});

export type UsdChart = z.infer<typeof UsdChartType>;

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
    maxSymbols: MAX_CHART_SYMBOLS,
  };
}

const roundUsd = (value: number) => Math.round(value * 100) / 100;
const roundAmount = (value: number) =>
  value === 0 ? 0 : Number(value.toPrecision(6));

type NetworkEntry = {
  total: number[];
  bySymbol: Map<
    string | null,
    { rank: number; usd: number[]; amount: number[] }
  >;
};

function networkEntry(
  networks: Map<bigint, NetworkEntry>,
  chainId: bigint,
  days: number,
) {
  let network = networks.get(chainId);
  if (!network) {
    network = { total: Array<number>(days).fill(0), bySymbol: new Map() };
    networks.set(chainId, network);
  }
  return network;
}

function symbolEntry(network: NetworkEntry, row: ChartSeriesRow, days: number) {
  let entry = network.bySymbol.get(row.symbol);
  if (!entry) {
    entry = {
      rank: Number(row.rank),
      usd: Array<number>(days).fill(0),
      amount: Array<number>(days).fill(0),
    };
    network.bySymbol.set(row.symbol, entry);
  }
  return entry;
}

/** Lays the ranked rows of a chart query out as one array per series. */
export function toUsdChart(rows: ChartSeriesRow[], dates: string[]): UsdChart {
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const networks = new Map<bigint, NetworkEntry>();

  for (const row of rows) {
    const index = dateIndex.get(row.date);
    if (index === undefined) continue;
    const network = networkEntry(networks, BigInt(row.chain_id), dates.length);
    const entry = symbolEntry(network, row, dates.length);
    entry.usd[index] = roundUsd(row.usd);
    entry.amount[index] = roundAmount(row.amount ?? 0);
    network.total[index] += row.usd;
  }

  return {
    dates,
    networks: [...networks.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([chainId, { total, bySymbol }]) => ({
        chain_id: toHex(chainId),
        usd: total.map(roundUsd),
        tokens: [...bySymbol.entries()]
          .filter(([symbol]) => symbol !== null)
          .sort(([, a], [, b]) => a.rank - b.rank)
          .map(([symbol, { usd, amount }]) => ({
            symbol: symbol as string,
            usd,
            amount,
          })),
        other: bySymbol.get(null)?.usd ?? null,
      })),
  };
}
