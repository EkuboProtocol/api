import { PoolState } from "./queries";

export function findAllRoutes(
  fromToken: bigint,
  toToken: bigint,
  pools: PoolState[],
  maxPools: number = 2,
  currentRoute: PoolState[] = []
) {
  return pools.flatMap((pool) => {
    if (currentRoute.includes(pool)) return [];
    const [token0, token1] = [BigInt(pool.token0), BigInt(pool.token1)];

    if (token0 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (token1 === toToken) {
        return [nextRoute];
      }

      if (maxPools > 1) {
        return findAllRoutes(token1, toToken, pools, maxPools - 1, nextRoute);
      }

      return [];
    } else if (token1 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (token0 === toToken) {
        return [nextRoute];
      }

      if (maxPools > 1) {
        return findAllRoutes(token1, toToken, pools, maxPools - 1, nextRoute);
      }

      return [];
    } else {
      return [];
    }
  });
}
