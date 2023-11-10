const MAX_ID = 10 ** 10 - 1;

export function parseId(id: string): number | null {
  let num = Number(id);
  if (Number.isNaN(num) || !Number.isSafeInteger(num)) {
    return null;
  }
  if (num > MAX_ID) {
    return null;
  }
  return num;
}
