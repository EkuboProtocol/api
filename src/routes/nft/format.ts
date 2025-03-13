import { z } from "zod";
import Decimal from "decimal.js-light";
import { NumericStringType } from "../../shared/validation/address";

export interface NFTMetadata {
  name: string;

  description: string;

  image: string;

  attributes: {
    trait_type: string;
    value: string;
  }[];
}

export const NUM_DIGITS = 12;
Decimal.config({ toExpNeg: -NUM_DIGITS, toExpPos: NUM_DIGITS });

const BASE = new Decimal("1.000001");
const MIN_PRICE_RENDER = new Decimal(10).pow(-NUM_DIGITS);
const MAX_PRICE_RENDER = new Decimal(10).pow(NUM_DIGITS);

export function formattedPrice(
  tick: number,
  numeratorDecimals: number,
  denominatorDecimals: number,
): string {
  const p = BASE.pow(tick.toString()).mul(
    new Decimal(10).pow(denominatorDecimals - numeratorDecimals),
  );

  if (p.lt(MIN_PRICE_RENDER)) {
    return "0.0";
  }

  if (p.gt(MAX_PRICE_RENDER)) {
    return "∞";
  }

  return Number(p.toSignificantDigits(12)).toLocaleString("en-US");
}

const U128 = new Decimal(2).pow(128);

export function feeToPercent(fee: string) {
  return new Decimal(fee).div(U128).mul(100).toSignificantDigits(2).toString();
}

export function tickSpacingToPercent(tick_spacing: string) {
  return BASE.pow(tick_spacing)
    .sub(1)
    .mul(100)
    .toSignificantDigits(2)
    .toString();
}

export const TokenIdType = NumericStringType;
