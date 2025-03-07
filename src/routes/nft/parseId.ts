export function parseId(id: string): number | null {
  let num = Number(id);
  if (Number.isNaN(num) || !Number.isSafeInteger(num)) {
    return null;
  }
  return num;
}
