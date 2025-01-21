export const MAX_POSITION_TOKEN_ID = 2 ** 40 - 1;

export function parseId(id: string): number | null {
  let num = Number(id);
  if (Number.isNaN(num) || !Number.isSafeInteger(num)) {
    return null;
  }
  if (num > MAX_POSITION_TOKEN_ID) {
    return null;
  }
  return num;
}
