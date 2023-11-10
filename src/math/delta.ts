import { MAX_U128, MAX_U256 } from "./constants";

export function amount0Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean
): bigint {
  if (liquidity === 0n || sqrtRatioA === sqrtRatioB) return 0n;

  [sqrtRatioA, sqrtRatioB] =
    sqrtRatioA < sqrtRatioB
      ? [sqrtRatioA, sqrtRatioB]
      : [sqrtRatioB, sqrtRatioA];

  const num = (liquidity << 128n) * (sqrtRatioB - sqrtRatioA);

  let result0 = num / sqrtRatioB;
  if (roundUp && num % sqrtRatioB !== 0n) {
    result0++;
  }

  if (result0 > MAX_U256) {
    throw new Error("AMOUNT0_DELTA_OVERFLOW");
  }
  let result = result0 / sqrtRatioA;
  if (roundUp && result % sqrtRatioA !== 0n) {
    result++;
  }

  if (result > MAX_U128) {
    throw new Error("AMOUNT0_DELTA_OVERFLOW");
  }

  return result;
}

export function amount1Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean
): bigint {
  if (liquidity === 0n || sqrtRatioA === sqrtRatioB) return 0n;

  [sqrtRatioA, sqrtRatioB] =
    sqrtRatioA < sqrtRatioB
      ? [sqrtRatioA, sqrtRatioB]
      : [sqrtRatioB, sqrtRatioA];

  const result = liquidity * (sqrtRatioB - sqrtRatioA);

  if (result > MAX_U256) {
    throw new Error("AMOUNT1_DELTA_OVERFLOW");
  }

  if (roundUp && result % 2n ** 128n !== 0n) {
    const x = (result >> 128n) + 1n;
    if (x > MAX_U128) {
      throw new Error("AMOUNT1_DELTA_OVERFLOW");
    }
    return x;
  } else {
    return result >> 128n;
  }
}
