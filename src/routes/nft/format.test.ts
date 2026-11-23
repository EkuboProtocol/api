import { describe, expect, it } from "bun:test";

import {
  TokenIdType,
  feeToPercent,
  formatAmount,
  formatTimeToUTC,
  formattedPrice,
  tickSpacingToPercent,
} from "./format";

const scale = (decimals: number, multiplier = "1") => ({
  decimals,
  multiplier,
});

describe("formattedPrice", () => {
  it("returns 0.0 when price is below the render threshold", () => {
    expect(formattedPrice(-27_631_035, scale(0), scale(0))).toBe("0.0");
  });

  it("returns ∞ when price exceeds the render ceiling", () => {
    expect(formattedPrice(27_631_035, scale(0), scale(0))).toBe("∞");
  });

  it("collapses short zero sequences into single-digit subscripts", () => {
    const price = formattedPrice(-11_512_932, scale(0), scale(0));
    expect(price.startsWith("0.0₅")).toBe(true);
  });

  it("collapses long zero sequences into multi-digit subscripts", () => {
    const price = formattedPrice(-25_000_000, scale(0), scale(0));
    expect(price.startsWith("0.0₁₀")).toBe(true);
  });

  it("applies decimal offsets between numerator and denominator", () => {
    expect(formattedPrice(0, scale(6), scale(18))).toBe("1,000,000,000,000");
  });

  it("shows the price per multiplied unit of each token", () => {
    // 738.92 USDG (6 decimals) per raw SNDK (18 decimals, 8x): 92.365 a share.
    const tick = Math.round(Math.log(738.92e-12) / Math.log(1.000001));
    expect(formattedPrice(tick, scale(6), scale(18, "8"))).toBe("92.365");
    // The inverse, SNDK shares per USDG.
    expect(formattedPrice(-tick, scale(18, "8"), scale(6))).toBe("0.0108266");
  });
});

describe("formatAmount", () => {
  it("applies decimals and the multiplier", () => {
    expect(formatAmount(10n ** 18n, scale(18))).toBe("1");
    expect(formatAmount(10n ** 18n, scale(18, "8"))).toBe("8");
    expect(formatAmount("1500000", scale(6, "1.032812345678901234"))).toBe(
      "1.54922",
    );
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
