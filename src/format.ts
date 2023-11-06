import Decimal from "decimal.js-light";

const BASE = new Decimal("1.000001");

export function formattedPrice(
  tick: bigint,
  numeratorDecimals: number,
  denominatorDecimals: number
): string {
  return BASE.pow(tick.toString())
    .mul(new Decimal(10).pow(denominatorDecimals - numeratorDecimals))
    .toSignificantDigits(6)
    .toString();
}

export function numericToHex(x: bigint | number | string) {
  return `0x${BigInt(x).toString(16)}`;
}

const U128 = new Decimal(2).pow(128);

export function feeToPercent(fee: string) {
  return new Decimal(fee).div(U128).mul(100).toSignificantDigits(4).toString();
}

export function tickSpacingToPercent(tick_spacing: string) {
  return BASE.pow(tick_spacing)
    .sub(1)
    .mul(100)
    .toSignificantDigits(4)
    .toString();
}
