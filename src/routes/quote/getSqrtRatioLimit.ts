import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "./math/tick";

export function getSqrtRatioLimit(
  sqrtRatio: bigint,
  sqrtRatioAfter: bigint,
  tickSpacing: number
): bigint {
  if (sqrtRatioAfter === sqrtRatio) {
    return sqrtRatioAfter;
  }
  const multiplier = toSqrtRatio(tickSpacing * 127);
  if (sqrtRatioAfter > sqrtRatio) {
    const next = (sqrtRatioAfter * multiplier) / (1n << 128n);
    if (next > MAX_SQRT_RATIO) {
      return MAX_SQRT_RATIO - 1n;
    }
    return next;
  } else {
    const next = (sqrtRatioAfter * (1n << 128n)) / multiplier;
    if (next < MIN_SQRT_RATIO) {
      return MIN_SQRT_RATIO + 1n;
    }
    return next;
  }
}
