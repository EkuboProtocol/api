export function parseTokenId(id: string): bigint | null {
  try {
    return BigInt(id);
  } catch (error) {
    return null;
  }
}
