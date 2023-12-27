const MAX = 1n << 128n;

export default function msb(x: bigint): number {
  if (x >= MAX) {
    throw new Error("x too large");
  }
  if (x <= 0n) {
    throw new Error("x must be positive");
  }
  let res = 0;
  if (x >= 0x10000000000000000n) {
    x = x >> 64n;
    res += 64;
  }
  if (x >= 0x100000000n) {
    x = x >> 32n;
    res += 32;
  }
  if (x >= 0x10000n) {
    x = x >> 16n;
    res += 16;
  }
  if (x >= 0x100n) {
    x = x >> 8n;
    res += 8;
  }
  if (x >= 0x10n) {
    x = x >> 4n;
    res += 4;
  }
  if (x >= 0x04n) {
    x = x >> 2n;
    res += 2;
  }
  if (x >= 0x02n) {
    res += 1;
  }
  return res;
}
