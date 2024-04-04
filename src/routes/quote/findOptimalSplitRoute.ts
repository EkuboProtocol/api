import {
  BaseNodeState,
  BaseResources,
  QuoteMeta,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";
import { GasEstimator } from "./quoteRoute";
import {
  getBestSingularRoute,
  GetBestSingularRouteResult,
} from "./getBestSingularRoute";

export function findOptimalSplitRoute<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  allRoutes,
  tokenAmount,
  gasEstimator,
  maxSplits,
  overrides,
  meta,
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  maxSplits: number;
  overrides: WeakMap<
    TQuoteNode,
    { state: TState; resources: TResources; increasing: boolean }
  >;
  meta: QuoteMeta;
}): GetBestSingularRouteResult<TResources, TState, TQuoteNode>[] | null {
  const maxRoutes = maxSplits + 1;
  const numPieces = 2 ** maxSplits;
  const smallestAmount = tokenAmount.amount / BigInt(numPieces);
  const swaps: GetBestSingularRouteResult<TResources, TState, TQuoteNode>[] =
    [];

  let routeOptions = allRoutes;

  let numUniqueRoutes = 0;
  const uniqueRouteSet: Set<TQuoteNode[]> = new Set();

  for (let i = 0; i < numPieces; i++) {
    const partialTokenAmount = {
      token: tokenAmount.token,
      amount:
        // for the last piece, we need to add the remainder so we always quote the exact amount
        i === numPieces - 1
          ? smallestAmount + (tokenAmount.amount % BigInt(numPieces))
          : smallestAmount,
    };

    if (partialTokenAmount.amount === 0n) continue;

    const partialResult = getBestSingularRoute({
      allRoutes: routeOptions,
      tokenAmount: partialTokenAmount,
      gasEstimator,
      meta,
      overrides,
    });

    if (!partialResult) {
      return null;
    }

    for (let j = 0; j < partialResult.route.length; j++) {
      const quote = partialResult.quoteRouteResult.quotes[j];
      overrides.set(partialResult.route[j], {
        state: quote.stateAfter,
        resources: quote.executionResources,
        increasing: quote.isPriceIncreasing,
      });
    }

    if (!uniqueRouteSet.has(partialResult.route)) {
      uniqueRouteSet.add(partialResult.route);
      numUniqueRoutes++;

      if (numUniqueRoutes === maxRoutes) {
        routeOptions = [...uniqueRouteSet.values()];
      }
    }

    const lastSwap = swaps[swaps.length - 1];
    // sent more through the same route so add it to the last call
    if (lastSwap?.route === partialResult.route) {
      lastSwap.quoteRouteResult = {
        calculatedAmount: {
          token: lastSwap.quoteRouteResult.calculatedAmount.token,
          amount:
            lastSwap.quoteRouteResult.calculatedAmount.amount +
            partialResult.quoteRouteResult.calculatedAmount.amount,
        },
        gasAdjustedCalculatedAmount:
          lastSwap.quoteRouteResult.gasAdjustedCalculatedAmount +
          partialResult.quoteRouteResult.gasAdjustedCalculatedAmount,
        quotes: partialResult.quoteRouteResult.quotes.map(
          (newQuoteResult, ix) => ({
            isPriceIncreasing: newQuoteResult.isPriceIncreasing,
            // use the latter state, since it is the most updated
            stateAfter: newQuoteResult.stateAfter,
            calculatedAmount:
              newQuoteResult.calculatedAmount +
              lastSwap.quoteRouteResult.quotes[ix].calculatedAmount,
            consumedAmount:
              newQuoteResult.consumedAmount +
              lastSwap.quoteRouteResult.quotes[ix].consumedAmount,
            executionResources: newQuoteResult.executionResources,
          }),
        ),
      };
    } else {
      swaps.push(partialResult);
    }
  }

  return swaps;
}
