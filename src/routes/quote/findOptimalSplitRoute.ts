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
import { isPriceIncreasing } from "./math/swap";

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
  const selectedRoutes: GetBestSingularRouteResult<
    TResources,
    TState,
    TQuoteNode
  >[] = [];

  let routeOptions = allRoutes;

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

    // merge in the new route to the result
    const existingRouteResultIndex = selectedRoutes.findIndex(
      (r) => r.route === partialResult.route,
    );

    if (existingRouteResultIndex === -1) {
      selectedRoutes.push(partialResult);
    } else {
      const lastRouteExecution = selectedRoutes[existingRouteResultIndex];
      selectedRoutes[existingRouteResultIndex] = {
        route: partialResult.route,
        quoteRouteResult: {
          calculatedAmount: {
            token: lastRouteExecution.quoteRouteResult.calculatedAmount.token,
            amount:
              lastRouteExecution.quoteRouteResult.calculatedAmount.amount +
              partialResult.quoteRouteResult.calculatedAmount.amount,
          },
          gasAdjustedCalculatedAmount:
            lastRouteExecution.quoteRouteResult.gasAdjustedCalculatedAmount +
            partialResult.quoteRouteResult.gasAdjustedCalculatedAmount,
          quotes: partialResult.quoteRouteResult.quotes.map(
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
              executionResources: newQuoteResult.executionResources,
            }),
          ),
        },
      };
    }

    if (selectedRoutes.length === maxRoutes) {
      routeOptions = selectedRoutes.map((r) => r.route);
    } else {
      // filter out any routes that use the same pool of an existing route in the opposite direction
      routeOptions = routeOptions.filter((route) => {
        // either the route is already used so more can be pushed through it...
        if (selectedRoutes.some((r) => r.route === route)) return true;

        // or it does not use any of the same pools
        return route.reduce<
          { allowed: true; token: bigint } | { allowed: false }
        >(
          (memo, node) => {
            if (!memo.allowed) {
              return {
                allowed: false,
              };
            }

            const key = node.key;
            const isToken1 = memo.token === key.token1;
            const token = isToken1 ? key.token0 : key.token1;

            const previousUsage = overrides.get(node);
            // we know pools with no extension work fine like this...
            // todo: why doesn't twamm work when we do this
            if (!previousUsage || key.extension === 0n) {
              return {
                allowed: true,
                token,
              };
            }

            const increasing = isPriceIncreasing(tokenAmount.amount, isToken1);

            return { allowed: increasing === previousUsage.increasing, token };
          },
          { allowed: true, token: tokenAmount.token },
        ).allowed;
      });
    }
  }

  return selectedRoutes;
}
