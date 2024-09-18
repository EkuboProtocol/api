import { GasEstimator, quoteRoute, QuoteRouteResult } from "./quoteRoute";
import { Heap } from "heap-js";
import {
  BasePoolResources,
  BasePoolState,
  QuoteMeta,
  QuoteNode,
  TokenAmount,
} from "@ekubo/sdk";

export interface QuotedRoute<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
> {
  route: TQuoteNode[];
  quoteRouteResult: Readonly<QuoteRouteResult<TResources, TState>>;
}

function quoteRoutes<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  routes,
  tokenAmount,
  gasEstimator,
  overrides,
  meta,
}: {
  routes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  overrides: WeakMap<TQuoteNode, TState>;
  meta: QuoteMeta;
}): QuotedRoute<TResources, TState, TQuoteNode>[] {
  return routes
    .map((route) => {
      return {
        route,
        quoteRouteResult: quoteRoute({
          route,
          specifiedAmount: tokenAmount,
          gasEstimator,
          overrides,
          meta,
        }),
      };
    })
    .filter(
      (r): r is QuotedRoute<TResources, TState, TQuoteNode> =>
        r.quoteRouteResult !== null,
    );
}

export function findOptimalSplitRoute<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  allRoutes,
  tokenAmount,
  gasEstimator,
  maxSplits,
  meta,
}: {
  allRoutes: TQuoteNode[][];
  tokenAmount: TokenAmount;
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  maxSplits: number;
  meta: QuoteMeta;
}): QuotedRoute<TResources, TState, TQuoteNode>[] | null {
  const maxRoutes = maxSplits + 1;
  const numPieces = 2 ** maxSplits;
  const smallestAmount = tokenAmount.amount / BigInt(numPieces);
  const swaps: QuotedRoute<TResources, TState, TQuoteNode>[] = [];

  const partialTokenAmount = {
    token: tokenAmount.token,
    amount: smallestAmount,
  };

  const heap = new Heap<QuotedRoute<TResources, TState, TQuoteNode>>((a, b) =>
    Number(
      b.quoteRouteResult.gasAdjustedCalculatedAmount -
        a.quoteRouteResult.gasAdjustedCalculatedAmount,
    ),
  );
  heap.setLimit(numPieces);

  const overrides = new WeakMap<TQuoteNode, TState>();

  heap.init(
    quoteRoutes({
      routes: allRoutes,
      tokenAmount: partialTokenAmount,
      gasEstimator,
      overrides,
      meta,
    }),
  );

  const uniqueRouteSet: Set<TQuoteNode[]> = new Set();

  for (let i = 0; i < numPieces; i++) {
    const partialResult = heap.pop();
    if (!partialResult) return null;

    for (let j = 0; j < partialResult.route.length; j++) {
      const quote = partialResult.quoteRouteResult.quotes[j];
      overrides.set(partialResult.route[j], quote.stateAfter);
    }

    // we use this to determine whether we need to recompute quotes
    const isLastPiece = i === numPieces - 1;

    if (!uniqueRouteSet.has(partialResult.route)) {
      uniqueRouteSet.add(partialResult.route);

      if (uniqueRouteSet.size === maxRoutes && !isLastPiece) {
        // no longer consider any routes other than what has already been selected
        for (const item of heap.toArray()) {
          if (!uniqueRouteSet.has(item.route)) {
            heap.remove(item);
          }
        }
      }

      swaps.push(partialResult);
    } else {
      // route is used in the list of swaps, so check that the pools are not touched in any swaps after it
      const indexLastSwapSameRoute = swaps.findLastIndex(
        (s) => s.route === partialResult.route,
      );
      if (indexLastSwapSameRoute === -1) {
        throw new Error("Expected to find this route among results");
      }

      // check that the swaps after this one did not touch the same pools
      let canMerge = true;
      for (let i = indexLastSwapSameRoute + 1; i < swaps.length; i++) {
        if (
          swaps[i].route.some((node0) =>
            partialResult.route.some((node1) => node0 === node1),
          )
        ) {
          canMerge = false;
          break;
        }
      }

      if (canMerge) {
        const lastSwap = swaps[indexLastSwapSameRoute];
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
              feesPaid:
                lastSwap.quoteRouteResult.quotes[ix].feesPaid +
                newQuoteResult.feesPaid,
              executionResources: lastSwap.route[ix].combineResources(
                lastSwap.quoteRouteResult.quotes[ix].executionResources,
                newQuoteResult.executionResources,
              ),
            }),
          ),
        };
      } else {
        swaps.push(partialResult);
      }
    }

    // we need to requote all the routes that use the same pools as the best route after updating the overrides
    if (!isLastPiece) {
      const requote: TQuoteNode[][] = [partialResult.route];

      for (const quotedRoute of heap.toArray()) {
        // there is a shared node between the two routes
        if (
          partialResult.route.some((nodeA) =>
            quotedRoute.route.some((nodeB) => nodeA === nodeB),
          )
        ) {
          heap.remove(quotedRoute);
          requote.push(quotedRoute.route);
        }
      }
      heap.addAll(
        quoteRoutes({
          routes: requote,
          tokenAmount: partialTokenAmount,
          gasEstimator,
          overrides,
          meta,
        }),
      );
    }
  }

  const remainder = tokenAmount.amount % BigInt(numPieces);

  if (remainder != 0n) {
    // todo: we can do slightly better in which route we select to avoid errors, e.g. if the quote node can
    //  only quote the exact amount and not a single wei more
    swaps[0].quoteRouteResult.quotes[0] = {
      ...swaps[0].quoteRouteResult.quotes[0],
      consumedAmount:
        swaps[0].quoteRouteResult.quotes[0].consumedAmount + remainder,
    };
  }

  return swaps;
}
