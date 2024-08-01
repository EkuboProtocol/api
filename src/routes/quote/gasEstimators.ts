import { GasEstimator } from "./quoteRoute";
import Decimal from "decimal.js-light";
import {
  BasePool,
  BasePoolResources,
  BasePoolState,
  Quote,
  QuoteNode,
  TwammPool,
  TwammPoolState,
  TwammResources,
} from "@ekubo/sdk";

export class BaseResourcesGasEstimator
  implements GasEstimator<BasePoolResources, BasePoolState, QuoteNode>
{
  public readonly baseEthSwapCost: Decimal;

  public get ethPerInitializedTickCrossed(): Decimal {
    return this.baseEthSwapCost.div(2);
  }

  public get ethPerTickSpacingCrossed(): Decimal {
    return this.ethPerInitializedTickCrossed.div(5);
  }

  readonly calculatedTokenPrice: Decimal;

  public constructor(calculatedTokenPrice: Decimal, baseEthSwapCost: Decimal) {
    this.calculatedTokenPrice = calculatedTokenPrice;
    this.baseEthSwapCost = baseEthSwapCost;
  }

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: QuoteNode[],
    quoteResults: Quote<BasePoolResources, BasePoolState>[],
    overrides: WeakMap<QuoteNode, BasePoolState>,
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
      },
    );

    const gasInOtherToken = BigInt(
      this.baseEthSwapCost
        .mul(totalRouteResources.newPoolsSwapped)
        .add(
          this.ethPerInitializedTickCrossed.mul(
            totalRouteResources.initializedTicksCrossed,
          ),
        )
        .add(
          this.ethPerTickSpacingCrossed.mul(
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
      BasePoolResources | TwammResources,
      BasePoolState | TwammPoolState,
      BasePool | TwammPool
    >
{
  private readonly baseGasEstimator: BaseResourcesGasEstimator;

  public constructor(calculatedTokenPrice: Decimal, baseEthSwapCost: Decimal) {
    this.baseGasEstimator = new BaseResourcesGasEstimator(
      calculatedTokenPrice,
      baseEthSwapCost,
    );
  }

  public get executeVirtualOrdersCost() {
    return this.baseGasEstimator.baseEthSwapCost;
  }
  public get crossDeltaExecuteVirtualOrderCost() {
    return this.executeVirtualOrdersCost.div(10);
  }

  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: (TwammPool | BasePool)[],
    quoteResults: Quote<
      BasePoolResources | TwammResources,
      BasePoolState | TwammPoolState
    >[],
    overrides: WeakMap<BasePool | TwammPool, BasePoolState | TwammPoolState>,
  ): bigint {
    const baseAmount = this.baseGasEstimator.getGasAdjustedAmount(
      calculatedAmount,
      route,
      quoteResults,
      overrides,
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
            this.executeVirtualOrdersCost
              .add(
                this.crossDeltaExecuteVirtualOrderCost.mul(
                  resources.virtualOrderDeltaTimesCrossed,
                ),
              )
              .mul(this.baseGasEstimator.calculatedTokenPrice)
              .toFixed(0, Decimal.ROUND_DOWN),
          )
        );
      }, 0n)
    );
  }
}
