import { describe, expect, it } from "bun:test";
import {
  formatUiMultiplier,
  toDisplayAmount,
  toDisplayPairPrice,
  toDisplayUnitPrice,
} from "./displayScale";

const SNDK = { decimals: 18, multiplier: "8" };
const USDG = { decimals: 6, multiplier: "1" };

describe("formatUiMultiplier", () => {
  it("formats the 18-decimal on-chain value exactly", () => {
    expect(formatUiMultiplier("8000000000000000000")).toBe("8");
    expect(formatUiMultiplier(3001352514631277880n)).toBe(
      "3.00135251463127788",
    );
    expect(formatUiMultiplier("1032812345678901234")).toBe(
      "1.032812345678901234",
    );
    expect(formatUiMultiplier("500000000000000000")).toBe("0.5");
    expect(formatUiMultiplier("1")).toBe("0.000000000000000001");
  });

  it("is 1 without a multiplier", () => {
    expect(formatUiMultiplier(null)).toBe("1");
    expect(formatUiMultiplier(undefined)).toBe("1");
    expect(formatUiMultiplier("0")).toBe("1");
    expect(formatUiMultiplier("not a number")).toBe("1");
  });
});

describe("amounts", () => {
  it("multiply raw amounts by the multiplier", () => {
    expect(toDisplayAmount(10n ** 18n, SNDK)).toBe(8);
    expect(toDisplayAmount("2500000", USDG)).toBe(2.5);
  });
});

describe("prices", () => {
  it("divide a price per raw token by the multiplier", () => {
    expect(toDisplayUnitPrice(738.92, SNDK)).toBeCloseTo(92.365, 10);
    expect(toDisplayUnitPrice(1, USDG)).toBe(1);
  });

  it("divide by the base multiplier and multiply by the quote multiplier", () => {
    // 738.92 USDG per SNDK: raw USDG units per raw SNDK unit.
    const raw = 738.92e6 / 1e18;
    expect(toDisplayPairPrice(raw, SNDK, USDG)).toBeCloseTo(92.365, 10);
    expect(toDisplayPairPrice(1 / raw, USDG, SNDK)).toBeCloseTo(1 / 92.365, 12);
  });

  it("leave tokens without a multiplier unchanged", () => {
    expect(toDisplayPairPrice(2, USDG, USDG)).toBe(2);
    expect(toDisplayAmount(1n, { decimals: 0, multiplier: "1" })).toBe(1);
  });
});
