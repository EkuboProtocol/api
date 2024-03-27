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
  poolStateOverrides,
  meta,
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  maxSplits: number;
  poolStateOverrides: WeakMap<TQuoteNode, TState>;
  meta: QuoteMeta;
}): GetBestSingularRouteResult<TResources, TState, TQuoteNode>[] | null {
  const maxRoutes = maxSplits + 1;
  const numPieces = 2 ** maxSplits;
  const smallestAmount = tokenAmount.amount / BigInt(numPieces);
  const results: GetBestSingularRouteResult<TResources, TState, TQuoteNode>[] =
    [];

  for (let i = 0; i < numPieces; i++) {
    const tokenAmountPortion = {
      token: tokenAmount.token,
      amount:
        // for the last piece, we need to add the remainder so we always quote the exact amount
        i === numPieces - 1
          ? smallestAmount + (tokenAmount.amount % BigInt(numPieces))
          : smallestAmount,
    };

    if (tokenAmountPortion.amount === 0n) continue;

    const splitResult = getBestSingularRoute({
      allRoutes:
        results.length < maxRoutes ? allRoutes : results.map((r) => r.route),
      tokenAmount: tokenAmountPortion,
      gasEstimator,
      poolStateOverrides,
      meta,
    });

    if (!splitResult) {
      return null;
    }

    for (let j = 0; j < splitResult.route.length; j++) {
      poolStateOverrides.set(
        splitResult.route[j],
        splitResult.quoteRouteResult.quotes[j].stateAfter,
      );
    }

    // merge in the new route to the result
    const existingRouteResultIndex = results.findIndex(
      (r) => r.route === splitResult.route,
    );

    if (existingRouteResultIndex === -1) {
      results.push(splitResult);
    } else {
      const lastRouteExecution = results[existingRouteResultIndex];
      results[existingRouteResultIndex] = {
        route: splitResult.route,
        gasAdjustedCalculatedAmount:
          lastRouteExecution.gasAdjustedCalculatedAmount +
          splitResult.gasAdjustedCalculatedAmount,
        quoteRouteResult: {
          calculatedAmount: {
            token: lastRouteExecution.quoteRouteResult.calculatedAmount.token,
            amount:
              lastRouteExecution.quoteRouteResult.calculatedAmount.amount +
              splitResult.quoteRouteResult.calculatedAmount.amount,
          },
          gasAdjustedCalculatedAmount:
            lastRouteExecution.gasAdjustedCalculatedAmount +
            splitResult.gasAdjustedCalculatedAmount,
          quotes: splitResult.quoteRouteResult.quotes.map(
            (newQuoteResult, ix) => ({
              isPriceIncreasing: newQuoteResult.isPriceIncreasing,
              // use the latter state, since it is the most updated
              stateAfter: newQuoteResult.stateAfter,
              calculatedAmount:
                newQuoteResult.calculatedAmount +
                lastRouteExecution.quoteRouteResult.quotes[ix].calculatedAmount,
              consumedAmount:
                newQuoteResult.consumedAmount +
                lastRouteExecution.quoteRouteResult.quotes[ix].consumedAmount,
              // todo: these cannot be trivially combined, need a solution where the quote node can handle it, e.g. by
              //  returning the combined result from quote
              executionResources: {
                ...newQuoteResult.executionResources,
                tickSpacingsCrossed:
                  newQuoteResult.executionResources.tickSpacingsCrossed +
                  lastRouteExecution.quoteRouteResult.quotes[ix]
                    .executionResources.tickSpacingsCrossed,
                initializedTicksCrossed:
                  newQuoteResult.executionResources.initializedTicksCrossed +
                  lastRouteExecution.quoteRouteResult.quotes[ix]
                    .executionResources.initializedTicksCrossed,
              },
            }),
          ),
        },
      };
    }
  }

  return results;
}
