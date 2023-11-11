import {
  amountBeforeFee,
  computeFee,
  computeStep,
  isPriceIncreasing,
} from "./swap";
import { MIN_SQRT_RATIO } from "./tick";

describe(isPriceIncreasing, () => {
  it("many cases", () => {
    expect(isPriceIncreasing(0n, false)).toBe(false);
    expect(isPriceIncreasing(1n, false)).toBe(false);
    expect(isPriceIncreasing(-1n, false)).toBe(true);
    expect(isPriceIncreasing(0n, true)).toBe(true);
    expect(isPriceIncreasing(1n, true)).toBe(true);
    expect(isPriceIncreasing(-1n, true)).toBe(false);
  });
});

describe(amountBeforeFee, () => {
  it("rounds up", () => {
    expect(amountBeforeFee(105n, (1n << 128n) / 100n)).toMatchInlineSnapshot(
      `107n`
    );
  });
});

describe(computeFee, () => {
  it("rounds up", () => {
    expect(computeFee(105n, (1n << 128n) / 100n)).toMatchInlineSnapshot(`2n`);
  });
  it("rounds evenly", () => {
    expect(computeFee(100n, (1n << 128n) / 100n)).toMatchInlineSnapshot(`1n`);
  });
});

describe(computeStep, () => {
  it("zero_amount_token0", () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: false,
        fee: 0n,
      })
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });
  it("zero_amount_token1", () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: true,
        fee: 0n,
      })
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });
  it("swap_ratio_equal_limit_token1", () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0x100000000000000000000000000000000n,
        amount: 10000n,
        isToken1: true,
        fee: 0n,
      })
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });

  it.only("max limit token0 input", () => {
    expect(
  computeStep({
    sqrtRatio: 0x100000000000000000000000000000000n,
    liquidity: 100000n,
    sqrtRatioLimit: MIN_SQRT_RATIO,
    amount: 10000n,
    isToken1: false,
    fee: 1n << 127n
  })
).toMatchInlineSnapshot(`
{
  "calculatedAmount": 4761n,
  "consumedAmount": 10000n,
  "feeAmount": 5000n,
  "sqrtRatioNext": 324078444686608060441309149935017344244n,
}
`);
  });
});
