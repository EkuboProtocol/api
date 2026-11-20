import { describe, expect, it } from "bun:test";
import { chartDates, chartWindow, toUsdChartSeries } from "./chartSeries";

const NOW = Date.parse("2026-11-20T15:30:00Z");

describe("chartDates", () => {
  it("ends on the UTC day of now, oldest first", () => {
    const dates = chartDates(NOW);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-10-22");
    expect(dates[29]).toBe("2026-11-20");
  });

  it("ranks from the last two dates", () => {
    const window = chartWindow(NOW);
    expect(window.firstDate).toBe("2026-10-22");
    expect(window.lastDate).toBe("2026-11-20");
    expect(window.rankFromDate).toBe("2026-11-19");
  });
});

describe("toUsdChartSeries", () => {
  const dates = ["2026-11-18", "2026-11-19", "2026-11-20"];

  it("orders series by rank, fills missing days and splits out other", () => {
    const result = toUsdChartSeries(
      [
        {
          group_key: "WETH",
          rank: "2",
          date: "2026-11-20",
          usd: 30,
          amount: 0.01,
        },
        {
          group_key: "USDC",
          rank: "1",
          date: "2026-11-18",
          usd: 100.004,
          amount: 100,
        },
        {
          group_key: "USDC",
          rank: "1",
          date: "2026-11-20",
          usd: 101,
          amount: 101,
        },
        {
          group_key: null,
          rank: "6",
          date: "2026-11-19",
          usd: 4.5,
          amount: null,
        },
        { group_key: "USDC", rank: "1", date: "2026-01-01", usd: 1, amount: 1 },
      ],
      dates,
      "token",
    );

    expect(result).toEqual({
      dates,
      groupBy: "token",
      series: [
        { key: "USDC", usd: [100, 0, 101], amount: [100, 0, 101] },
        { key: "WETH", usd: [0, 0, 30], amount: [0, 0, 0.01] },
      ],
      other: [0, 4.5, 0],
    });
  });

  it("keys networks by hex chain ID and leaves out amounts", () => {
    const result = toUsdChartSeries(
      [
        {
          group_key: "8453",
          rank: 1,
          date: "2026-11-19",
          usd: 5,
          amount: null,
        },
      ],
      dates,
      "chain",
    );

    expect(result.series).toEqual([
      { key: "0x2105", usd: [0, 5, 0], amount: null },
    ]);
    expect(result.other).toBeNull();
  });
});
