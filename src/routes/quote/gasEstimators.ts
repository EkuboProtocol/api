import { GasEstimator } from "./quoteRoute";
import {
  BasePoolState,
  BasePoolResources,
  Quote,
  QuoteNode,
} from "./nodes/quoteNode";
import Decimal from "decimal.js-light";
import { TwammPool, TwammPoolState, TwammResources } from "./nodes/twammPool";
import { BasePool } from "./nodes/basePool";

export class BaseResourcesGasEstimator
  implements GasEstimator<BasePoolResources, BasePoolState, QuoteNode>
{
  // These parameters are used for optimizing when we should use multi-hop routes
  public static ETH_PER_POOL_SWAPPED = new Decimal("1e13");
  public static ETH_PER_INITIALIZED_TICK_CROSS =
    BaseResourcesGasEstimator.ETH_PER_POOL_SWAPPED.div(2);
  public static ETH_PER_TICK_SPACING_CROSSED =
    BaseResourcesGasEstimator.ETH_PER_INITIALIZED_TICK_CROSS.div(5);

  readonly calculatedTokenPrice: Decimal;

  public constructor(calculatedTokenPrice: Decimal) {
    this.calculatedTokenPrice = calculatedTokenPrice;
  }

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: QuoteNode[],
    quoteResults: Quote<BasePoolResources, BasePoolState>[],
    overrides: WeakMap<QuoteNode, BasePoolState>
  ): bigint {
    const totalRouteResources = route.reduce(
      (memo, node, ix) => {
        return {
          newPoolsSwapped: overrides.has(node)
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
      }
    );

    const gasInOtherToken = BigInt(
      BaseResourcesGasEstimator.ETH_PER_POOL_SWAPPED.mul(
        totalRouteResources.newPoolsSwapped
      )
        .add(
          BaseResourcesGasEstimator.ETH_PER_INITIALIZED_TICK_CROSS.mul(
            totalRouteResources.initializedTicksCrossed
          )
        )
        .add(
          BaseResourcesGasEstimator.ETH_PER_TICK_SPACING_CROSSED.mul(
            totalRouteResources.tickSpacingsCrossed
          )
        )
        .mul(this.calculatedTokenPrice)
        .toFixed(0, Decimal.ROUND_DOWN)
    );

    return calculatedAmount - gasInOtherToken;
  }
}

export class BaseOrTwammResourcesGasEstimator
  implements
    GasEstimator<
      BasePoolResources | TwammResources,
      BasePoolState | TwammPoolState,
      BasePool | TwammPool
    >
{
  private readonly baseGasEstimator: BaseResourcesGasEstimator;

  public constructor(calculatedTokenPrice: Decimal) {
    this.baseGasEstimator = new BaseResourcesGasEstimator(calculatedTokenPrice);
  }

  public static EXECUTION_COST_EXECUTE_VIRTUAL_ORDERS = new Decimal("1e13");
  public static EXECUTION_COST_EXECUTE_VIRTUAL_ORDERS_CROSS_DELTA = new Decimal(
    "1e14"
  );

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: (TwammPool | BasePool)[],
    quoteResults: Quote<
      BasePoolResources | TwammResources,
      BasePoolState | TwammPoolState
    >[],
    overrides: WeakMap<BasePool | TwammPool, BasePoolState | TwammPoolState>
  ): bigint {
    const baseAmount = this.baseGasEstimator.getGasAdjustedAmount(
      calculatedAmount,
      route,
      quoteResults,
      overrides
    );

    return (
      baseAmount -
      route.reduce<bigint>((memo, node, ix) => {
        if (!(node instanceof TwammPool) || overrides.has(node)) return memo;

        const resources = quoteResults[ix].executionResources;

        if (!("virtualOrderSecondsExecuted" in resources)) return memo;

        if (resources.virtualOrderSecondsExecuted === 0) return memo;

        return (
          memo +
          BigInt(
            BaseOrTwammResourcesGasEstimator.EXECUTION_COST_EXECUTE_VIRTUAL_ORDERS.add(
              BaseOrTwammResourcesGasEstimator.EXECUTION_COST_EXECUTE_VIRTUAL_ORDERS_CROSS_DELTA.mul(
                resources.virtualOrderDeltaTimesCrossed
              )
            )
              .mul(this.baseGasEstimator.calculatedTokenPrice)
              .toFixed(0, Decimal.ROUND_DOWN)
          )
        );
      }, 0n)
    );
  }
}
