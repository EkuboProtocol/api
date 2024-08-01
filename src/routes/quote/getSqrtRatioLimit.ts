import { toSqrtRatio } from "@ekubo/sdk";

const MAX_TICK = 88722883;
const MAX_SQRT_RATIO: bigint =
  6277100250585753475930931601400621808602321654880405518632n;
const MIN_SQRT_RATIO: bigint = 18446748437148339061n;

export function getSqrtRatioLimit(
  sqrtRatioAfter: bigint,
  tickSpacing: number,
  increasing: boolean,
): bigint {
  const rootMultiplier = toSqrtRatio(Math.min(tickSpacing * 127, MAX_TICK));
  const multiplier = rootMultiplier * rootMultiplier;
  if (increasing) {
    const next = (sqrtRatioAfter * multiplier) / (1n << 256n);
    if (next > MAX_SQRT_RATIO) {
      return MAX_SQRT_RATIO - 1n;
    }
    return next;
  } else {
    const next = (sqrtRatioAfter * (1n << 256n)) / multiplier;
    if (next < MIN_SQRT_RATIO) {
      return MIN_SQRT_RATIO + 1n;
    }
    return next;
  }
}
