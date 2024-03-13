import {
  BaseNodeState,
  BaseResources,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";
import { GasEstimator, quoteRoute, QuoteRouteResult } from "./quoteRoute";

export interface GetBestSingularRouteResult<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TQuoteNode extends QuoteNode<TResources, TState>,
> {
  route: TQuoteNode[];
  quoteRouteResult: Readonly<QuoteRouteResult<TResources, TState>>;
  gasAdjustedCalculatedAmount: bigint;
}

/**
 * Given a list of routes, returns the route that provides the optimal gas adjusted calculated amount
 * @param allRoutes all the routes to try
 * @param tokenAmount the amount being passed through each route
 * @param gasEstimator used for computing the gas adjusted calculated amount for each route
 * @param poolStates optionally override the states on the quoting
 */
export function getBestSingularRoute<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  allRoutes,
  tokenAmount,
  gasEstimator,
  poolStateOverrides,
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  poolStateOverrides: WeakMap<TQuoteNode, TState>;
}): GetBestSingularRouteResult<TResources, TState, TQuoteNode> | null {
  return allRoutes.reduce<GetBestSingularRouteResult<
    TResources,
    TState,
    TQuoteNode
  > | null>((memo, route) => {
    try {
      const result = quoteRoute<TResources, TState, TQuoteNode>({
        specifiedAmount: tokenAmount,
        route,
        gasEstimator,
        poolStateOverrides,
      });

      if (result) {
        if (
          !memo ||
          result.gasAdjustedCalculatedAmount > memo.gasAdjustedCalculatedAmount
        ) {
          return {
            route,
            quoteRouteResult: result,
            gasAdjustedCalculatedAmount: result.gasAdjustedCalculatedAmount,
          };
        }
      }

      return memo;
    } catch (e) {
      return memo;
    }
  }, null);
}
