import {
  BasePoolResources,
  BasePoolState,
  Quote,
  QuoteMeta,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";

export interface GasEstimator<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
> {
  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: TQuoteNode[],
    quoteResults: Quote<TResources, TState>[],
    overrides: WeakMap<TQuoteNode, TState>,
  ): bigint;
}

export interface QuoteRouteResult<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
> {
  calculatedAmount: TokenAmount;
  gasAdjustedCalculatedAmount: bigint;
  quotes: Quote<TResources, TState>[];
}

/**
 * Quotes a single route, and also computes the gas adjusted amount using the given gas estimator
 * @param specifiedAmount
 * @param route
 * @param gasEstimator
 * @param poolStateOverrides
 */
export function quoteRoute<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  specifiedAmount,
  route,
  gasEstimator,
  overrides,
  meta,
}: {
  specifiedAmount: TokenAmount;
  route: TQuoteNode[];
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  overrides: WeakMap<TQuoteNode, TState>;
  meta: QuoteMeta;
}): Readonly<QuoteRouteResult<TResources, TState>> | null {
  const isExactOutput = specifiedAmount.amount < 0n;
  const result = route.reduce<null | {
    quotes: Quote<TResources, TState>[];
    calculatedAmount: TokenAmount;
  }>(
    (state, node) => {
      if (!state) return null;
      const isToken1 = node.key.token1 === state.calculatedAmount.token;

      let quote: Quote<TResources, TState>;
      try {
        quote = node.quote({
          tokenAmount: state.calculatedAmount,
          overrideState: overrides.get(node),
          meta,
        });
      } catch (e) {
        console.error(e);
        return null;
      }

      if (quote.consumedAmount !== state.calculatedAmount.amount) {
        // partial swaps through a route are not supported
        return null;
      }

      const nextToken = BigInt(isToken1 ? node.key.token0 : node.key.token1);

      state.quotes.push(quote);

      return {
        calculatedAmount: {
          amount: isExactOutput
            ? -quote.calculatedAmount
            : quote.calculatedAmount,
          token: nextToken,
        },
        quotes: state.quotes,
      };
    },
    {
      calculatedAmount: specifiedAmount,
      quotes: [],
    },
  );

  if (!result) return null;

  return {
    calculatedAmount: result.calculatedAmount,
    quotes: result.quotes,
    gasAdjustedCalculatedAmount: gasEstimator.getGasAdjustedAmount(
      result.calculatedAmount.amount,
      route,
      result.quotes,
      overrides,
    ),
  };
}
