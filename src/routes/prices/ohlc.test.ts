import { describe, expect, test } from "bun:test";
import {
  orientOhlcCandle,
  PoolPriceHistoryPointType,
  type CanonicalOhlcCandle,
} from "./index";

const candle: CanonicalOhlcCandle = {
  start: "2026-08-18T00:00:00.000Z",
  open: 2,
  high: 8,
  low: 1,
  close: 4,
  volume0: "100",
  volume1: "250",
  swap_count: 7,
};

describe("orientOhlcCandle", () => {
  test("passes a candle through when the base token sorts first", () => {
    expect(orientOhlcCandle(candle, true)).toEqual({
      start: "2026-08-18T00:00:00.000Z",
      open: 2,
      high: 8,
      low: 1,
      close: 4,
      volume_base: "100",
      volume_quote: "250",
      swap_count: 7,
    });
  });

  test("inverts the price and swaps the extremes when the base token sorts second", () => {
    expect(orientOhlcCandle(candle, false)).toEqual({
      start: "2026-08-18T00:00:00.000Z",
      // Open and close stay at their own ends: they are anchored in time.
      open: 1 / 2,
      // The high becomes the inverse of the low, and vice versa.
      high: 1 / 1,
      low: 1 / 8,
      close: 1 / 4,
      // The volumes swap roles along with the tokens.
      volume_base: "250",
      volume_quote: "100",
      swap_count: 7,
    });
  });

  test("keeps low <= open, close <= high in both orientations", () => {
    for (const baseBeforeQuote of [true, false]) {
      const oriented = orientOhlcCandle(candle, baseBeforeQuote);
      expect(oriented.low).toBeLessThanOrEqual(oriented.open);
      expect(oriented.low).toBeLessThanOrEqual(oriented.close);
      expect(oriented.high).toBeGreaterThanOrEqual(oriented.open);
      expect(oriented.high).toBeGreaterThanOrEqual(oriented.close);
    }
  });

  test("inverting twice returns the original candle", () => {
    const inverted = orientOhlcCandle(candle, false);
    const roundTripped = orientOhlcCandle(
      {
        start: inverted.start,
        open: inverted.open,
        high: inverted.high,
        low: inverted.low,
        close: inverted.close,
        volume0: inverted.volume_base,
        volume1: inverted.volume_quote,
        swap_count: inverted.swap_count,
      },
      false,
    );

    expect(roundTripped.open).toBeCloseTo(candle.open, 12);
    expect(roundTripped.high).toBeCloseTo(candle.high, 12);
    expect(roundTripped.low).toBeCloseTo(candle.low, 12);
    expect(roundTripped.close).toBeCloseTo(candle.close, 12);
    expect(roundTripped.volume_base).toBe(candle.volume0);
    expect(roundTripped.volume_quote).toBe(candle.volume1);
  });

  test("leaves a zero price alone rather than returning infinity", () => {
    const degenerate = orientOhlcCandle({ ...candle, low: 0 }, false);
    expect(degenerate.high).toBe(0);
    expect(Number.isFinite(degenerate.open)).toBe(true);
  });
});

describe("PoolPriceHistoryPointType", () => {
  const prices = {
    start: "2026-08-18T00:00:00.000Z",
    open: 2,
    high: 8,
    low: 1,
    close: 4,
  };

  test("carries the volumes of a candle built from swaps", () => {
    const parsed = PoolPriceHistoryPointType.parse({
      ...prices,
      volume0: "100",
      volume1: "250",
      swap_count: 7,
    });

    expect(parsed.volume0).toBe("100");
    expect(parsed.swap_count).toBe(7);
  });

  test("accepts a candle that measures no swaps", () => {
    // A candle carrying the price forward over a quiet stretch, and one
    // projected from TWAMM sale rates, describe no indexed trades. Clients
    // read the absent volume as "not measured" and draw no bar, which is why
    // these fields must stay optional rather than default to zero.
    const parsed = PoolPriceHistoryPointType.parse(prices);

    expect(parsed.volume0).toBeUndefined();
    expect(parsed.volume1).toBeUndefined();
    expect(parsed.swap_count).toBeUndefined();
  });
});
