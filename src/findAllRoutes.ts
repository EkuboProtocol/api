import { QuoteNode } from "./nodes/quoteNode";

export function findAllRoutes(
  fromToken: bigint,
  toToken: bigint,
  nodes: QuoteNode<unknown>[],
  maxPools: number = 2,
  currentRoute: QuoteNode<unknown>[] = []
): QuoteNode<unknown>[][] {
  if (maxPools < 1) return [];
  return nodes.flatMap((pool) => {
    if (currentRoute.includes(pool)) return [];

    if (pool.key.token0 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (pool.key.token1 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        pool.key.token1,
        toToken,
        nodes,
        maxPools - 1,
        nextRoute
      );
    } else if (pool.key.token1 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (pool.key.token0 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        pool.key.token0,
        toToken,
        nodes,
        maxPools - 1,
        nextRoute
      );
    } else {
      return [];
    }
  });
}
