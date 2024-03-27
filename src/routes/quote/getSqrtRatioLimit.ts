import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  toSqrtRatio,
} from "./math/tick";

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
