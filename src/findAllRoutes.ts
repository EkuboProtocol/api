type Pair = { token0: bigint; token1: bigint };

export function findAllRoutes<T extends Pair>(
  fromToken: bigint,
  toToken: bigint,
  pools: T[],
  maxPools: number = 2,
  currentRoute: T[] = []
): T[][] {
  if (maxPools < 1) return [];
  return pools.flatMap((pool) => {
    if (currentRoute.includes(pool)) return [];

    if (pool.token0 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (pool.token1 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        pool.token1,
        toToken,
        pools,
        maxPools - 1,
        nextRoute
      );
    } else if (pool.token1 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (pool.token0 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(
        pool.token0,
        toToken,
        pools,
        maxPools - 1,
        nextRoute
      );
    } else {
      return [];
    }
  });
}
