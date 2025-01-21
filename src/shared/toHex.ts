export default function toHex(
  n: string | bigint | number,
  numBytes: number = 0,
): `0x${string}` {
  return `0x${BigInt(n)
    .toString(16)
    .padStart(numBytes * 2, "0")}`;
}
