import {
  BaseNodeState,
  BaseResources,
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
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  maxSplits: number;
  poolStateOverrides: WeakMap<TQuoteNode, TState>;
}): GetBestSingularRouteResult<TResources, TState, TQuoteNode>[] | null {
  if (maxSplits === 0) {
    const result = getBestSingularRoute({
      allRoutes,
      tokenAmount,
      gasEstimator,
      poolStateOverrides,
    });

    if (result === null) {
      return null;
    }

    return [result];
  }

  // Split the amount into two parts
  const firstHalfSpecifiedAmount = {
    ...tokenAmount,
    amount: tokenAmount.amount / 2n,
  };

  // Recursive calls for each half
  const firstHalfQuoteRoutes = findOptimalSplitRoute<
    TResources,
    TState,
    TQuoteNode
  >({
    tokenAmount: firstHalfSpecifiedAmount,
    allRoutes,
    poolStateOverrides,
    gasEstimator,
    maxSplits: maxSplits - 1,
  });

  if (firstHalfQuoteRoutes === null) {
    return null;
  }

  for (const route of firstHalfQuoteRoutes) {
    for (let i = 0; i < route.route.length; i++) {
      // todo: why do we have to cast?
      poolStateOverrides.set(
        route.route[i] as TQuoteNode,
        route.quoteRouteResult.quotes[i].stateAfter as TState,
      );
    }
  }

  const secondHalfSpecifiedAmount = {
    ...tokenAmount,
    amount: tokenAmount.amount - firstHalfSpecifiedAmount.amount,
  };
  const secondHalfQuoteRoutes = findOptimalSplitRoute({
    tokenAmount: secondHalfSpecifiedAmount,
    allRoutes,
    poolStateOverrides,
    gasEstimator,
    maxSplits: maxSplits - firstHalfQuoteRoutes.length,
  });

  if (secondHalfQuoteRoutes === null) {
    return null;
  }

  for (const route of secondHalfQuoteRoutes) {
    for (let i = 0; i < route.route.length; i++) {
      // todo: why do we have to cast?
      poolStateOverrides.set(
        route.route[i] as TQuoteNode,
        route.quoteRouteResult.quotes[i].stateAfter as TState,
      );
    }
  }

  const routeMap = new WeakMap<
    TQuoteNode[],
    GetBestSingularRouteResult<TResources, TState, TQuoteNode>
  >();
  const routeSet = new Set<TQuoteNode[]>();

  const combinedRoutes = firstHalfQuoteRoutes.concat(secondHalfQuoteRoutes);

  // merge routes here if there are duplicates.
  for (const routeExecution of combinedRoutes) {
    const lastRouteExecution = routeMap.get(routeExecution.route);
    if (!lastRouteExecution) {
      routeSet.add(routeExecution.route);
      routeMap.set(routeExecution.route, routeExecution);
    } else {
      routeMap.set(routeExecution.route, {
        route: routeExecution.route,
        gasAdjustedCalculatedAmount:
          lastRouteExecution.gasAdjustedCalculatedAmount +
          routeExecution.gasAdjustedCalculatedAmount,
        quoteRouteResult: {
          calculatedAmount: {
            token: lastRouteExecution.quoteRouteResult.calculatedAmount.token,
            amount:
              lastRouteExecution.quoteRouteResult.calculatedAmount.amount +
              routeExecution.quoteRouteResult.calculatedAmount.amount,
          },
          gasAdjustedCalculatedAmount:
            lastRouteExecution.gasAdjustedCalculatedAmount +
            routeExecution.gasAdjustedCalculatedAmount,
          quotes: routeExecution.quoteRouteResult.quotes.map(
            (newQuoteResult, ix) => ({
              // use the latter state, since it is the most updated
              stateAfter: newQuoteResult.stateAfter,
              calculatedAmount:
                newQuoteResult.calculatedAmount +
                lastRouteExecution.quoteRouteResult.quotes[ix].calculatedAmount,
              consumedAmount:
                newQuoteResult.consumedAmount +
                lastRouteExecution.quoteRouteResult.quotes[ix].consumedAmount,
              // todo: these cannot be trivially combined, but they are also not used in the result
              //  because each quote already has its own gas adjusted amount
              executionResources: newQuoteResult.executionResources,
            }),
          ),
        },
      });
    }
  }

  const dedupedRoutes: GetBestSingularRouteResult<
    TResources,
    TState,
    TQuoteNode
  >[] = [];

  routeSet.forEach((route) => {
    const resultForRoute = routeMap.get(route);
    if (resultForRoute) dedupedRoutes.push(resultForRoute);
  });

  return dedupedRoutes;
}
