import { MAX_U256 } from "./constants";

// ~ ln(2**128) * 2**64
export const EXPONENT_LIMIT: bigint = 1623313478486440542208n;

export function calculateNextSqrtRatio(
  sqrtRatio: bigint,
  liquidity: bigint,
  token0SaleRate: bigint,
  token1SaleRate: bigint,
  timeElapsed: bigint,
  fee: bigint,
): bigint {
  let sqrtSaleRatio = sqrt((token1SaleRate << 128n) / token0SaleRate) << 64n;

  if (liquidity === 0n) {
    return sqrtSaleRatio;
  }

  const sRate =
    (sqrt(token1SaleRate * token0SaleRate) * ((1n << 128n) - fee)) /
    (1n << 128n);

  const roundUp = sqrtRatio > sqrtSaleRatio;

  const exponent = div(0x200000000n * timeElapsed * sRate, liquidity, roundUp);

  if (exponent > EXPONENT_LIMIT) {
    return sqrtSaleRatio;
  }

  const e = exp(exponent);

  const [num, sign] = roundUp
    ? [sqrtRatio - sqrtSaleRatio, true]
    : [sqrtSaleRatio - sqrtRatio, false];

  const c = div(num << 128n, sqrtSaleRatio + sqrtRatio, roundUp);

  const [term1, term2] = [e - c, e + c];
  const scale = sign
    ? div(term2 << 128n, term1, roundUp)
    : div(term1 << 128n, term2, roundUp);

  return (sqrtSaleRatio * scale) >> 128n;
}

function div(x: bigint, y: bigint, round: boolean): bigint {
  const quotient = x / y;
  const remainder: bigint = x % y;
  return quotient + (remainder !== 0n && round ? 1n : 0n);
}

// Computes e^x where x is a fixed point 64.64 number and the result is a fixed point 128.128 number
export function exp(x: bigint): bigint {
  if (x >= 0x20000000000000000) {
    let half = exp(x / 2n);
    return (half * half) >> 128n;
  } else {
    return expInner(x);
  }
}

// Computes e^x where x is a fixed point 64.64 number that is less than the real number 2
function expInner(x: bigint): bigint {
  if (x >= 0x20000000000000000n) {
    throw new Error("Invalid input");
  }

  let ratio = 0x100000000000000000000000000000000n;

  if ((x & 0x1n) != 0n) {
    ratio = 0xffffffffffffffff0000000000000000n;
  }
  if ((x & 0x2n) != 0n) {
    ratio = (ratio * 0xfffffffffffffffe0000000000000002n) >> 128n;
  }
  if ((x & 0x4n) != 0n) {
    ratio = (ratio * 0xfffffffffffffffc0000000000000008n) >> 128n;
  }
  if ((x & 0x8n) != 0n) {
    ratio = (ratio * 0xfffffffffffffff80000000000000020n) >> 128n;
  }
  if ((x & 0x10n) != 0n) {
    ratio = (ratio * 0xfffffffffffffff00000000000000080n) >> 128n;
  }
  if ((x & 0x20n) != 0n) {
    ratio = (ratio * 0xffffffffffffffe00000000000000200n) >> 128n;
  }
  if ((x & 0x40n) != 0n) {
    ratio = (ratio * 0xffffffffffffffc00000000000000800n) >> 128n;
  }
  if ((x & 0x80n) != 0n) {
    ratio = (ratio * 0xffffffffffffff800000000000002000n) >> 128n;
  }
  if ((x & 0x100n) != 0n) {
    ratio = (ratio * 0xffffffffffffff000000000000008000n) >> 128n;
  }
  if ((x & 0x200n) != 0n) {
    ratio = (ratio * 0xfffffffffffffe000000000000020000n) >> 128n;
  }
  if ((x & 0x400n) != 0n) {
    ratio = (ratio * 0xfffffffffffffc000000000000080000n) >> 128n;
  }
  if ((x & 0x800n) != 0n) {
    ratio = (ratio * 0xfffffffffffff8000000000000200000n) >> 128n;
  }
  if ((x & 0x1000n) != 0n) {
    ratio = (ratio * 0xfffffffffffff0000000000000800000n) >> 128n;
  }
  if ((x & 0x2000n) != 0n) {
    ratio = (ratio * 0xffffffffffffe0000000000002000000n) >> 128n;
  }
  if ((x & 0x4000n) != 0n) {
    ratio = (ratio * 0xffffffffffffc0000000000008000000n) >> 128n;
  }
  if ((x & 0x8000n) != 0n) {
    ratio = (ratio * 0xffffffffffff80000000000020000000n) >> 128n;
  }
  if ((x & 0x10000n) != 0n) {
    ratio = (ratio * 0xffffffffffff00000000000080000000n) >> 128n;
  }
  if ((x & 0x20000n) != 0n) {
    ratio = (ratio * 0xfffffffffffe00000000000200000000n) >> 128n;
  }
  if ((x & 0x40000n) != 0n) {
    ratio = (ratio * 0xfffffffffffc00000000000800000000n) >> 128n;
  }
  if ((x & 0x80000n) != 0n) {
    ratio = (ratio * 0xfffffffffff800000000002000000000n) >> 128n;
  }
  if ((x & 0x100000n) != 0n) {
    ratio = (ratio * 0xfffffffffff000000000008000000000n) >> 128n;
  }
  if ((x & 0x200000n) != 0n) {
    ratio = (ratio * 0xffffffffffe000000000020000000000n) >> 128n;
  }
  if ((x & 0x400000n) != 0n) {
    ratio = (ratio * 0xffffffffffc00000000007ffffffffffn) >> 128n;
  }
  if ((x & 0x800000n) != 0n) {
    ratio = (ratio * 0xffffffffff80000000001ffffffffffbn) >> 128n;
  }
  if ((x & 0x1000000n) != 0n) {
    ratio = (ratio * 0xffffffffff00000000007fffffffffd5n) >> 128n;
  }
  if ((x & 0x2000000n) != 0n) {
    ratio = (ratio * 0xfffffffffe0000000001fffffffffeabn) >> 128n;
  }
  if ((x & 0x4000000n) != 0n) {
    ratio = (ratio * 0xfffffffffc0000000007fffffffff555n) >> 128n;
  }
  if ((x & 0x8000000n) != 0n) {
    ratio = (ratio * 0xfffffffff8000000001fffffffffaaabn) >> 128n;
  }
  if ((x & 0x10000000n) != 0n) {
    ratio = (ratio * 0xfffffffff0000000007ffffffffd5555n) >> 128n;
  }
  if ((x & 0x20000000n) != 0n) {
    ratio = (ratio * 0xffffffffe000000001ffffffffeaaaabn) >> 128n;
  }
  if ((x & 0x40000000n) != 0n) {
    ratio = (ratio * 0xffffffffc000000007ffffffff555555n) >> 128n;
  }
  if ((x & 0x80000000n) != 0n) {
    ratio = (ratio * 0xffffffff800000001ffffffffaaaaaabn) >> 128n;
  }
  if ((x & 0x100000000n) != 0n) {
    ratio = (ratio * 0xffffffff000000007fffffffd5555555n) >> 128n;
  }
  if ((x & 0x200000000n) != 0n) {
    ratio = (ratio * 0xfffffffe00000001fffffffeaaaaaaabn) >> 128n;
  }
  if ((x & 0x400000000n) != 0n) {
    ratio = (ratio * 0xfffffffc00000007fffffff555555560n) >> 128n;
  }
  if ((x & 0x800000000n) != 0n) {
    ratio = (ratio * 0xfffffff80000001fffffffaaaaaaab55n) >> 128n;
  }
  if ((x & 0x1000000000n) != 0n) {
    ratio = (ratio * 0xfffffff00000007ffffffd5555556000n) >> 128n;
  }
  if ((x & 0x2000000000n) != 0n) {
    ratio = (ratio * 0xffffffe0000001ffffffeaaaaaab5555n) >> 128n;
  }
  if ((x & 0x4000000000n) != 0n) {
    ratio = (ratio * 0xffffffc0000007ffffff555555600000n) >> 128n;
  }
  if ((x & 0x8000000000n) != 0n) {
    ratio = (ratio * 0xffffff8000001ffffffaaaaaab555555n) >> 128n;
  }
  if ((x & 0x10000000000n) != 0n) {
    ratio = (ratio * 0xffffff0000007fffffd555555ffffffen) >> 128n;
  }
  if ((x & 0x20000000000n) != 0n) {
    ratio = (ratio * 0xfffffe000001fffffeaaaaab55555511n) >> 128n;
  }
  if ((x & 0x40000000000n) != 0n) {
    ratio = (ratio * 0xfffffc000007fffff555555ffffff777n) >> 128n;
  }
  if ((x & 0x80000000000n) != 0n) {
    ratio = (ratio * 0xfffff800001fffffaaaaab5555544444n) >> 128n;
  }
  if ((x & 0x100000000000n) != 0n) {
    ratio = (ratio * 0xfffff000007ffffd55555fffffddddden) >> 128n;
  }
  if ((x & 0x200000000000n) != 0n) {
    ratio = (ratio * 0xffffe00001ffffeaaaab555551111128n) >> 128n;
  }
  if ((x & 0x400000000000n) != 0n) {
    ratio = (ratio * 0xffffc00007ffff55555fffff77777d28n) >> 128n;
  }
  if ((x & 0x800000000000n) != 0n) {
    ratio = (ratio * 0xffff80001ffffaaaab5555444445b05bn) >> 128n;
  }
  if ((x & 0x1000000000000n) != 0n) {
    ratio = (ratio * 0xffff00007fffd5555ffffdddde38e381n) >> 128n;
  }
  if ((x & 0x2000000000000n) != 0n) {
    ratio = (ratio * 0xfffe0001fffeaaab5555111127d276a7n) >> 128n;
  }
  if ((x & 0x4000000000000n) != 0n) {
    ratio = (ratio * 0xfffc0007fff5555ffff7777d27cf3cf5n) >> 128n;
  }
  if ((x & 0x8000000000000n) != 0n) {
    ratio = (ratio * 0xfff8001fffaaab55544445b0596597f9n) >> 128n;
  }
  if ((x & 0x10000000000000n) != 0n) {
    ratio = (ratio * 0xfff0007ffd555fffddde38e2be2d82d5n) >> 128n;
  }
  if ((x & 0x20000000000000n) != 0n) {
    ratio = (ratio * 0xffe001ffeaab55511127d21522f2295cn) >> 128n;
  }
  if ((x & 0x40000000000000n) != 0n) {
    ratio = (ratio * 0xffc007ff555fff777d279e7b87acece0n) >> 128n;
  }
  if ((x & 0x80000000000000n) != 0n) {
    ratio = (ratio * 0xff801ffaab554445b04105b043e8f48dn) >> 128n;
  }
  if ((x & 0x100000000000000n) != 0n) {
    ratio = (ratio * 0xff007fd55ffdde38d68f08c257e0ce3fn) >> 128n;
  }
  if ((x & 0x200000000000000n) != 0n) {
    ratio = (ratio * 0xfe01feab551127cbfe5f89994c44216fn) >> 128n;
  }
  if ((x & 0x400000000000000n) != 0n) {
    ratio = (ratio * 0xfc07f55ff77d2493e885eeaa756ad523n) >> 128n;
  }
  if ((x & 0x800000000000000n) != 0n) {
    ratio = (ratio * 0xf81fab5445aebc8a58055fcbbb139ae9n) >> 128n;
  }
  if ((x & 0x1000000000000000n) != 0n) {
    ratio = (ratio * 0xf07d5fde38151e72f18ff03049ac5d7fn) >> 128n;
  }
  if ((x & 0x2000000000000000n) != 0n) {
    ratio = (ratio * 0xe1eb51276c110c3c3eb1269f2f5d4afbn) >> 128n;
  }
  if ((x & 0x4000000000000000n) != 0n) {
    ratio = (ratio * 0xc75f7cf564105743415cbc9d6368f3b9n) >> 128n;
  }
  if ((x & 0x8000000000000000n) != 0n) {
    ratio = (ratio * 0x9b4597e37cb04ff3d675a35530cdd768n) >> 128n;
  }
  if ((x & 0x10000000000000000n) != 0n) {
    ratio = (ratio * 0x5e2d58d8b3bcdf1abadec7829054f90en) >> 128n;
  }

  if (x != 0n) {
    ratio = MAX_U256 / ratio;
  }

  return ratio;
}

export function sqrt(x: bigint): bigint {
  if (x < 0n) {
    throw new Error("Square root of negative numbers is not supported.");
  }
  if (x < 2n) {
    return x;
  }

  let x0: bigint = x / 2n;
  let x1: bigint = (x0 + x / x0) / 2n;

  while (x0 > x1) {
    x0 = x1;
    x1 = (x0 + x / x0) / 2n;
  }

  return x0;
}
