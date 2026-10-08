import toHex from "../../shared/toHex";

export type PricedTokenRow = {
  chain_id: bigint;
  token_address: string;
  token_decimals: number;
  usd_price: string | number;
};

export type TokenPricer = (
  chainId: string,
  token: string,
  amount: string,
) => number;

const tokenKey = (chainId: string, token: string) =>
  `${BigInt(chainId)}:${BigInt(token)}`;

// Matches the interface's former client-side sum: a token outside the
// canonical list, or without a price, contributes 0.
export function createTokenPricer(rows: PricedTokenRow[]): TokenPricer {
  const byKey = new Map<string, { price: number; scale: number }>();
  for (const row of rows) {
    const price = Number(row.usd_price);
    if (!Number.isFinite(price) || price === 0) continue;
    byKey.set(tokenKey(row.chain_id.toString(), row.token_address), {
      price,
      scale: 10 ** row.token_decimals,
    });
  }

  return (chainId, token, amount) => {
    const entry = byKey.get(tokenKey(chainId, token));
    if (!entry) return 0;
    return (Number(amount) / entry.scale) * entry.price;
  };
}

// Sums one or more USD fields per chain. Every chain present in `rows` gets an
// entry, so a chain whose tokens are all unpriced reports 0 rather than
// disappearing. Sorted by chain id for a stable response.
export function sumUsdByChain<F extends string>(
  fields: readonly F[],
  rows: { chain_id: string; usd: Partial<Record<F, number>> }[],
): ({ chain_id: string } & Record<F, number>)[] {
  const byChain = new Map<string, Record<F, number>>();
  for (const { chain_id, usd } of rows) {
    const chainId = toHex(BigInt(chain_id));
    let totals = byChain.get(chainId);
    if (!totals) {
      totals = Object.fromEntries(fields.map((f) => [f, 0])) as Record<
        F,
        number
      >;
      byChain.set(chainId, totals);
    }
    for (const field of fields) totals[field] += usd[field] ?? 0;
  }
  return [...byChain.entries()]
    .sort(([a], [b]) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    )
    .map(([chain_id, totals]) => ({ chain_id, ...totals }));
}

export function sumFields<F extends string>(
  fields: readonly F[],
  rows: Record<F, number>[],
): Record<F, number> {
  return Object.fromEntries(
    fields.map((f) => [f, rows.reduce((total, row) => total + row[f], 0)]),
  ) as Record<F, number>;
}

export const utcDateString = (date: Date | string) =>
  new Date(date).toISOString().slice(0, 10);
