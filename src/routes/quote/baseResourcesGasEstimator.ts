import { GasEstimator } from "./quoteRoute";
import {
  BaseNodeState,
  BaseResources,
  Quote,
  QuoteNode,
} from "./nodes/quoteNode";
import Decimal from "decimal.js-light";

export class BaseResourcesGasEstimator
  implements GasEstimator<BaseResources, BaseNodeState, QuoteNode>
{
  // These parameters are used for optimizing when we should use multi-hop routes
  public static ETH_PER_POOL_SWAPPED = new Decimal("1e13");
  public static ETH_PER_INITIALIZED_TICK_CROSS = new Decimal("1e12");
  public static ETH_PER_TICK_SPACING_CROSSED = new Decimal("5e10");

  private readonly calculatedTokenPrice: Decimal;

  public constructor(calculatedTokenPrice: Decimal) {
    this.calculatedTokenPrice = calculatedTokenPrice;
  }

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: QuoteNode[],
    quoteResults: Quote<BaseResources, BaseNodeState>[],
    poolStateOverrides: WeakMap<QuoteNode, BaseNodeState>,
  ): bigint {
    const totalRouteResources = route.reduce(
      (memo, node, ix) => {
        return {
          newPoolsSwapped: poolStateOverrides.has(node)
            ? memo.newPoolsSwapped
            : memo.newPoolsSwapped + 1,
          initializedTicksCrossed:
            memo.initializedTicksCrossed +
            quoteResults[ix].executionResources.initializedTicksCrossed,
          tickSpacingsCrossed:
            memo.initializedTicksCrossed +
            quoteResults[ix].executionResources.tickSpacingsCrossed,
        };
      },
      {
        newPoolsSwapped: 0,
        initializedTicksCrossed: 0,
        tickSpacingsCrossed: 0,
      },
    );

    const gasInOtherToken = BigInt(
      BaseResourcesGasEstimator.ETH_PER_POOL_SWAPPED.mul(
        totalRouteResources.newPoolsSwapped,
      )
        .add(
          BaseResourcesGasEstimator.ETH_PER_INITIALIZED_TICK_CROSS.mul(
            totalRouteResources.initializedTicksCrossed,
          ),
        )
        .add(
          BaseResourcesGasEstimator.ETH_PER_TICK_SPACING_CROSSED.mul(
            totalRouteResources.tickSpacingsCrossed,
          ),
        )
        .mul(this.calculatedTokenPrice)
        .toFixed(0, Decimal.ROUND_DOWN),
    );

    return calculatedAmount - gasInOtherToken;
  }
}
