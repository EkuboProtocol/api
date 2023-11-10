import { PoolState } from "./queries";

type Pair = Pick<PoolState, "token0" | "token1">;

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
    const [token0, token1] = [BigInt(pool.token0), BigInt(pool.token1)];

    if (token0 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (token1 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(token1, toToken, pools, maxPools - 1, nextRoute);
    } else if (token1 === fromToken) {
      const nextRoute = currentRoute.concat([pool]);

      if (token0 === toToken) {
        return [nextRoute];
      }

      return findAllRoutes(token0, toToken, pools, maxPools - 1, nextRoute);
    } else {
      return [];
    }
  });
}
