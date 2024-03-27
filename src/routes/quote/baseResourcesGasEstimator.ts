import { GasEstimator } from "./quoteRoute";
import {
  BaseNodeState,
  BaseResources,
  Quote,
  QuoteNode,
} from "./nodes/quoteNode";
import Decimal from "decimal.js-light";
import { TwammPool, TwammPoolState, TwammResources } from "./nodes/twammPool";
import { BasePool } from "./nodes/basePool";

export class BaseResourcesGasEstimator
  implements GasEstimator<BaseResources, BaseNodeState, QuoteNode>
{
  // These parameters are used for optimizing when we should use multi-hop routes
  public static ETH_PER_POOL_SWAPPED = new Decimal("1e13");
  public static ETH_PER_INITIALIZED_TICK_CROSS =
    BaseResourcesGasEstimator.ETH_PER_POOL_SWAPPED.div(2);
  public static ETH_PER_TICK_SPACING_CROSSED =
    BaseResourcesGasEstimator.ETH_PER_INITIALIZED_TICK_CROSS.div(5);

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

export class BaseOrTwammResourcesGasEstimator
  implements
    GasEstimator<
      BaseResources | TwammResources,
      BaseNodeState | TwammPoolState,
      BasePool | TwammPool
    >
{
  private readonly baseGasEstimator: BaseResourcesGasEstimator;

  public constructor(calculatedTokenPrice: Decimal) {
    this.baseGasEstimator = new BaseResourcesGasEstimator(calculatedTokenPrice);
  }

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: (TwammPool | BasePool)[],
    quoteResults: Quote<
      BaseResources | TwammResources,
      BaseNodeState | TwammPoolState
    >[],
    poolStateOverrides: WeakMap<
      TwammPool | BasePool,
      BaseNodeState | TwammPoolState
    >,
  ): bigint {
    const baseAmount = this.baseGasEstimator.getGasAdjustedAmount(
      calculatedAmount,
      route,
      quoteResults,
      poolStateOverrides,
    );

    const adjusted =
      baseAmount -
      route.reduce<bigint>((memo, value) => {
        if (!(route instanceof TwammPool)) return memo;

        // todo: estimate gas of twamm swap
        return memo;
      }, 0n);

    return adjusted;
  }
}
