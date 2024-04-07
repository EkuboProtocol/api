import {
  BasePoolState,
  BasePoolResources,
  QuoteMeta,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";
import { GasEstimator, quoteRoute, QuoteRouteResult } from "./quoteRoute";

export interface GetBestSingularRouteResult<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
> {
  route: TQuoteNode[];
  quoteRouteResult: Readonly<QuoteRouteResult<TResources, TState>>;
}

/**
 * Given a list of routes, returns the route that provides the optimal gas adjusted calculated amount
 * @param allRoutes all the routes to try
 * @param tokenAmount the amount being passed through each route
 * @param gasEstimator used for computing the gas adjusted calculated amount for each route
 * @param poolStates optionally override the states on the quoting
 */
export function getBestSingularRoute<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  allRoutes,
  tokenAmount,
  gasEstimator,
  overrides,
  meta,
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  overrides: WeakMap<TQuoteNode, TState>;
  meta: QuoteMeta;
}): GetBestSingularRouteResult<TResources, TState, TQuoteNode> | null {
  return allRoutes.reduce<GetBestSingularRouteResult<
    TResources,
    TState,
    TQuoteNode
  > | null>((memo, route) => {
    try {
      const quoteRouteResult = quoteRoute<TResources, TState, TQuoteNode>({
        specifiedAmount: tokenAmount,
        route,
        gasEstimator,
        overrides,
        meta,
      });

      if (quoteRouteResult) {
        if (
          !memo ||
          quoteRouteResult.gasAdjustedCalculatedAmount >
            memo.quoteRouteResult.gasAdjustedCalculatedAmount
        ) {
          return {
            route,
            quoteRouteResult,
          };
        }
      }

      return memo;
    } catch (e) {
      return memo;
    }
  }, null);
}
