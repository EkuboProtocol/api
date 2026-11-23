// How a token's raw amounts are shown: its decimals and its UI multiplier.
//
// The multiplier is a display unit like decimals. Robinhood Stock Tokens, for
// example, show one token as `multiplier` shares after a stock split or as
// dividends compound. Stored amounts and prices stay per raw token; only what
// is formatted for people goes through here:
//
//   shown amount = raw amount / 10^decimals * multiplier
//   shown price of a base token in a quote token
//     = raw price * 10^(base decimals - quote decimals)
//       * quote multiplier / base multiplier
//
// so a token's USD price per share is its raw-token USD price / multiplier.

export interface TokenDisplayScale {
  decimals: number;
  /** Exact decimal string, "1" for a token without a multiplier. */
  multiplier: string;
}

const MULTIPLIER_DECIMALS = 18;

/**
 * The on-chain multiplier (18 decimals, e.g. 8e18 for 8x) as an exact decimal
 * string without trailing zeros. A token without one, or with a zero or
 * malformed value, shows as "1".
 */
export function formatUiMultiplier(
  raw: string | bigint | null | undefined,
): string {
  if (raw === null || raw === undefined) return "1";
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return "1";
  }
  if (value <= 0n) return "1";
  const digits = value.toString().padStart(MULTIPLIER_DECIMALS + 1, "0");
  const whole = digits.slice(0, -MULTIPLIER_DECIMALS);
  const fraction = digits.slice(-MULTIPLIER_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function multiplierOf(token: TokenDisplayScale): number {
  const value = Number(token.multiplier);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** A raw amount in the units people see. */
export function toDisplayAmount(
  rawAmount: bigint | string | number,
  token: TokenDisplayScale,
): number {
  return (
    (Number(rawAmount.toString()) / 10 ** token.decimals) * multiplierOf(token)
  );
}

/** A price per raw token (USD or any other unit) as a price per shown unit. */
export function toDisplayUnitPrice(
  pricePerRawToken: number,
  token: TokenDisplayScale,
): number {
  return pricePerRawToken / multiplierOf(token);
}

/**
 * A raw price of `base` in `quote` (raw quote units per raw base unit) as the
 * price people see.
 */
export function toDisplayPairPrice(
  rawPrice: number,
  base: TokenDisplayScale,
  quote: TokenDisplayScale,
): number {
  return (
    rawPrice *
    10 ** (base.decimals - quote.decimals) *
    (multiplierOf(quote) / multiplierOf(base))
  );
}
