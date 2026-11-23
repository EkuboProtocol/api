import { describe, expect, it } from "bun:test";
import { chartDates, chartWindow, toUsdChart } from "./chartSeries";

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

describe("toUsdChart", () => {
  const dates = ["2026-11-18", "2026-11-19", "2026-11-20"];

  it("lays out each network's symbols by rank, its other symbols and its total", () => {
    const result = toUsdChart(
      [
        {
          chain_id: 8453n,
          symbol: "USDC",
          ui_multiplier: "1000000000000000000",
          rank: "1",
          date: "2026-11-19",
          usd: 5,
          amount: 5,
        },
        {
          chain_id: 1n,
          symbol: "WETH",
          ui_multiplier: "1000000000000000000",
          rank: "2",
          date: "2026-11-20",
          usd: 30,
          amount: 0.01,
        },
        {
          chain_id: 1n,
          symbol: "USDC",
          ui_multiplier: "1000000000000000000",
          rank: "1",
          date: "2026-11-18",
          usd: 100.004,
          amount: 100,
        },
        {
          chain_id: 1n,
          symbol: "USDC",
          ui_multiplier: "1000000000000000000",
          rank: "1",
          date: "2026-11-20",
          usd: 101,
          amount: 101,
        },
        {
          chain_id: 1n,
          symbol: null,
          ui_multiplier: null,
          rank: "6",
          date: "2026-11-19",
          usd: 4.5,
          amount: null,
        },
        {
          chain_id: 1n,
          symbol: "USDC",
          ui_multiplier: "1000000000000000000",
          rank: "1",
          date: "2026-01-01",
          usd: 1,
          amount: 1,
        },
      ],
      dates,
    );

    expect(result).toEqual({
      dates,
      networks: [
        {
          chain_id: "0x1",
          usd: [100, 4.5, 131],
          tokens: [
            {
              symbol: "USDC",
              multiplier: "1",
              usd: [100, 0, 101],
              amount: [100, 0, 101],
            },
            {
              symbol: "WETH",
              multiplier: "1",
              usd: [0, 0, 30],
              amount: [0, 0, 0.01],
            },
          ],
          other: [0, 4.5, 0],
        },
        {
          chain_id: "0x2105",
          usd: [0, 5, 0],
          tokens: [
            {
              symbol: "USDC",
              multiplier: "1",
              usd: [0, 5, 0],
              amount: [0, 5, 0],
            },
          ],
          other: null,
        },
      ],
    });
  });

  it("keeps a symbol's tokens with different multipliers apart", () => {
    const row = {
      chain_id: 1n,
      symbol: "SNDK",
      date: "2026-11-20",
    };
    const result = toUsdChart(
      [
        {
          ...row,
          ui_multiplier: "8000000000000000000",
          rank: "1",
          usd: 712,
          amount: 1,
        },
        {
          ...row,
          ui_multiplier: "1000000000000000000",
          rank: "2",
          usd: 3,
          amount: 2,
        },
      ],
      dates,
    );

    expect(result.networks[0].tokens).toEqual([
      { symbol: "SNDK", multiplier: "8", usd: [0, 0, 712], amount: [0, 0, 1] },
      { symbol: "SNDK", multiplier: "1", usd: [0, 0, 3], amount: [0, 0, 2] },
    ]);
  });

  it("has no networks without rows", () => {
    expect(toUsdChart([], dates)).toEqual({ dates, networks: [] });
  });
});
