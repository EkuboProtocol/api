import { describe, expect, it } from 'bun:test';

import {
  TokenIdType,
  feeToPercent,
  formatTimeToUTC,
  formattedPrice,
  tickSpacingToPercent,
} from "./format";

describe("formattedPrice", () => {
  it("returns 0.0 when price is below the render threshold", () => {
    expect(formattedPrice(-27_631_035, 0, 0)).toBe("0.0");
  });

  it("returns ∞ when price exceeds the render ceiling", () => {
    expect(formattedPrice(27_631_035, 0, 0)).toBe("∞");
  });

  it("collapses short zero sequences into single-digit subscripts", () => {
    const price = formattedPrice(-11_512_932, 0, 0);
    expect(price.startsWith("0.0₅")).toBe(true);
  });

  it("collapses long zero sequences into multi-digit subscripts", () => {
    const price = formattedPrice(-25_000_000, 0, 0);
    expect(price.startsWith("0.0₁₀")).toBe(true);
  });

  it("applies decimal offsets between numerator and denominator", () => {
    expect(formattedPrice(0, 6, 18)).toBe("1,000,000,000,000");
  });
});

describe("feeToPercent", () => {
  it("returns a three-significant-digit percentage", () => {
    expect(feeToPercent("5", "1000")).toBe("0.5%");
    expect(feeToPercent("175", "10000")).toBe("1.75%");
    expect(feeToPercent("1755", "10000")).toBe("17.6%");
    expect(feeToPercent("1748", "100000")).toBe("1.75%");
  });
});

describe("tickSpacingToPercent", () => {
  it("converts tick spacing into a percentage precision delta", () => {
    expect(tickSpacingToPercent("10")).toBe("0.001%");
    expect(tickSpacingToPercent("50")).toBe("0.005%");
  });
});

describe("formatTimeToUTC", () => {
  it("renders UTC timestamps with 12-hour clock formatting", () => {
    const midday = new Date(Date.UTC(2024, 0, 2, 13, 4, 5));
    expect(formatTimeToUTC(midday)).toBe("2024-01-02 01:04:05 PM UTC");
  });

  it("renders midnight as 12 AM", () => {
    const midnight = new Date(Date.UTC(2024, 6, 9, 0, 0, 1));
    expect(formatTimeToUTC(midnight)).toBe("2024-07-09 12:00:01 AM UTC");
  });
});

describe("TokenIdType", () => {
  it("reuses the NumericStringType schema", () => {
    expect(TokenIdType.safeParse("0xabc123").success).toBe(true);
    expect(TokenIdType.safeParse("123456").success).toBe(true);
    expect(TokenIdType.safeParse("invalid").success).toBe(false);
  });
});
