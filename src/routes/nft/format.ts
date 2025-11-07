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

const BASE = 1.000001;
const MIN_PRICE_RENDER = 10 ** -NUM_DIGITS;
const MAX_PRICE_RENDER = 10 ** NUM_DIGITS;

function collapseSubscripts(str: string) {
  return str.replace(/0{5,99}/, (x) => {
    if (x.length < 10) {
      return "0" + String.fromCodePoint(0x2080 + x.length);
    } else {
      return (
        "0" +
        String.fromCodePoint(0x2080 + Math.floor(x.length / 10)) +
        String.fromCodePoint(0x2080 + (x.length % 10))
      );
    }
  });
}

export function formattedPrice(
  tick: number,
  numeratorDecimals: number,
  denominatorDecimals: number,
): string {
  const p = BASE ** tick * 10 ** (denominatorDecimals - numeratorDecimals);

  if (p < MIN_PRICE_RENDER) {
    return "0.0";
  }

  if (p > MAX_PRICE_RENDER) {
    return "∞";
  }

  return collapseSubscripts(
    Number(p.toString()).toLocaleString("en-US", {
      minimumSignificantDigits: 1,
      maximumSignificantDigits: 6,
    }),
  );
}

export function feeToPercent(fee: string, feeDenominator: number): string {
  return ((Number(fee) / feeDenominator) * 100).toPrecision(3);
}

export function tickSpacingToPercent(tick_spacing: string): string {
  return ((BASE ** Number(tick_spacing) - 1) * 100).toPrecision(3);
}

export function formatTimeToUTC(date: Date) {
  let hours = date.getUTCHours();
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")} ${hours
    .toString()
    .padStart(2, "0")}:${minutes}:${seconds} ${ampm} UTC`;
}

export const TokenIdType = NumericStringType;
