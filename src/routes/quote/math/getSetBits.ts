// Returns all the indices of the set bits in a number
import msb from "./msb";

/**
 * Returns the set bits from most to least significant in the given biginteger
 * @param x the biginteger to compute the set bits of
 * @param maxLength the maximum number of set bits to return
 */
export default function getSetBits(
  x: bigint,
  maxLength: number = 128
): number[] {
  const res: number[] = [];
  while (x > 0n && res.length < maxLength) {
    const next = msb(x);
    res.push(next);
    x -= 1n << BigInt(next);
  }
  return res;
}
