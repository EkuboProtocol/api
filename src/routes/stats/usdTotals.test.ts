import { describe, expect, it } from "bun:test";
import {
  createTokenPricer,
  sumFields,
  sumUsdByChain,
  utcDateString,
} from "./usdTotals";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

describe("createTokenPricer", () => {
  const price = createTokenPricer([
    {
      chain_id: 1n,
      token_address: BigInt(USDC).toString(),
      token_decimals: 6,
      usd_price: "1",
    },
    {
      chain_id: 1n,
      token_address: BigInt(WETH).toString(),
      token_decimals: 18,
      usd_price: 2500,
    },
    {
      chain_id: 10n,
      token_address: BigInt(WETH).toString(),
      token_decimals: 18,
      usd_price: "0",
    },
  ]);

  it("scales by decimals and price, whatever the id encoding", () => {
    expect(price("0x1", USDC, "5000000")).toBe(5);
    expect(price("1", BigInt(WETH).toString(), "-2000000000000000000")).toBe(
      -5000,
    );
  });

  it("prices unknown or zero-priced tokens at 0", () => {
    expect(price("0x1", "0x1234", "1000")).toBe(0);
    expect(price("0x2", USDC, "1000")).toBe(0);
    expect(price("0xa", WETH, "1000000000000000000")).toBe(0);
  });
});

describe("sumUsdByChain", () => {
  it("groups by chain, keeps unpriced chains at 0 and sorts by chain id", () => {
    const fields = ["tvlUsd", "tvlDeltaUsdYesterday"] as const;
    const byChain = sumUsdByChain(fields, [
      { chain_id: "0x534e5f4d41494e", usd: { tvlUsd: 3 } },
      { chain_id: "1", usd: { tvlUsd: 1 } },
      { chain_id: "0x1", usd: { tvlUsd: 2, tvlDeltaUsdYesterday: -1 } },
      { chain_id: "0xa", usd: {} },
    ]);
    expect(byChain).toEqual([
      { chain_id: "0x1", tvlUsd: 3, tvlDeltaUsdYesterday: -1 },
      { chain_id: "0xa", tvlUsd: 0, tvlDeltaUsdYesterday: 0 },
      { chain_id: "0x534e5f4d41494e", tvlUsd: 3, tvlDeltaUsdYesterday: 0 },
    ]);
    expect(sumFields(fields, byChain)).toEqual({
      tvlUsd: 6,
      tvlDeltaUsdYesterday: -1,
    });
  });
});

describe("utcDateString", () => {
  it("formats dates and timestamps as UTC days", () => {
    expect(utcDateString(new Date("2026-10-07T00:00:00.000Z"))).toBe(
      "2026-10-07",
    );
    expect(utcDateString("2026-10-07T23:59:59.999Z")).toBe("2026-10-07");
  });
});
