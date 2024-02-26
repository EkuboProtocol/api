import { NodeKey, QuoteNode } from "./nodes/quoteNode";

export interface HasKey {
  key: NodeKey;
}

export function findAllRoutes<T extends HasKey>(
  fromToken: bigint,
  toToken: bigint,
  nodes: T[],
  maxPools: number = 2,
  currentRoute: T[] = []
): T[][] {
  if (maxPools < 1) return [];
  return nodes.flatMap((node) => {
    if (currentRoute.includes(node)) return [];

    if (node.key.token0 === fromToken) {
      const nextRoute = currentRoute.concat([node]);

      if (node.key.token1 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        node.key.token1,
        toToken,
        nodes,
        maxPools - 1,
        nextRoute
      );
    } else if (node.key.token1 === fromToken) {
      const nextRoute = currentRoute.concat([node]);

      if (node.key.token0 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        node.key.token0,
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
