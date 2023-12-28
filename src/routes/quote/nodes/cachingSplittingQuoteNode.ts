import {
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
  TokenAmount,
} from "./quoteNode";
import getSetBits, { increaseLowestSetBit } from "../math/getSetBits";
import { isPriceIncreasing } from "../math/swap";

export interface CachingSplittingQuoteNodeOptions<T> {
  readonly maxSplits?: number;

  resourcesReducer(memo: T, value: T): T;
}

interface Cache<T> {
  [bit: number]: {
    quote: Quote<T>;
    cache: Cache<T>;
  };
}

export class CachingSplittingQuoteNode<T> implements QuoteNode<T> {
  private readonly node: QuoteNode<T>;
  private readonly options: CachingSplittingQuoteNodeOptions<T>;
  private readonly cache0: Cache<T>;
  private readonly cache1: Cache<T>;

  /**
   * Note for this to work correctly, the node _must_ have a deterministic and cacheable quoting algorithm
   */
  constructor(
    node: QuoteNode<T>,
    options: CachingSplittingQuoteNodeOptions<T>
  ) {
    this.node = node;
    this.options = options;
    this.cache0 = {};
    this.cache1 = {};
  }

  get key(): NodeKey {
    return this.node.key;
  }

  quote(params: QuoteParams): Quote<T> {
    const { amount, token } = params.amount;
    if (amount === 0n) {
      return this.node.quote(params);
    }

    const isOutput = amount < 0n;

    const bits = getSetBits(
      isOutput ? -amount : amount,
      this.options.maxSplits
    );

    if (isOutput) {
      increaseLowestSetBit(bits);
    }

    // start by quoting 0
    let quote = this.node.quote({ ...params, amount: { amount: 0n, token } });
    let cache: Cache<T> =
      params.amount.token === this.node.key.token1 ? this.cache1 : this.cache0;

    const isIncreasing = isPriceIncreasing(
      params.amount.amount,
      params.amount.token === this.key.token1
    );

    // for each of the set bits in the input amount,
    // compute the quote result and then move the cache pointer to the cache for the resulting state
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      const tokenAmount = {
        token,
        amount: isOutput ? -(1n << BigInt(b)) : 1n << BigInt(b),
      };

      // the quote for this set-bit of the amount
      let partQuote: Quote<T>;

      {
        const cacheKey = isOutput ? -b : b;
        const cacheForBit = cache[cacheKey];
        if (cacheForBit) {
          partQuote = cacheForBit.quote;
          cache = cacheForBit.cache;
        } else {
          partQuote = this.node.quote({
            amount: tokenAmount,
            overrideSwapState: quote.stateAfter,
          });

          cache[cacheKey] = {
            quote: partQuote,
            cache: {},
          };
          cache = cache[cacheKey].cache;
        }
      }

      if (
        params.sqrtRatioLimit &&
        partQuote.stateAfter.sqrtRatio !== params.sqrtRatioLimit &&
        partQuote.stateAfter.sqrtRatio > params.sqrtRatioLimit === isIncreasing
      ) {
        partQuote = this.node.quote({
          amount: tokenAmount,
          overrideSwapState: quote.stateAfter,
          sqrtRatioLimit: params.sqrtRatioLimit,
        });
        // we need to make this assertion because the following iterations need to return early,
        // so that they don't touch the cache
        if (partQuote.stateAfter.sqrtRatio !== params.sqrtRatioLimit)
          throw new Error("Failed to hit limit on requote");
      }

      quote = <Quote<T>>{
        executionResources: this.options.resourcesReducer(
          quote.executionResources,
          partQuote.executionResources
        ),
        consumedAmount: quote.consumedAmount + partQuote.consumedAmount,
        calculatedAmount: quote.calculatedAmount + partQuote.calculatedAmount,
        stateAfter: partQuote.stateAfter,
      };

      if (quote.stateAfter.sqrtRatio === params.sqrtRatioLimit) {
        break;
      }
    }

    return quote;
  }

  hasLiquidity(): boolean {
    return this.node.hasLiquidity();
  }

  suggestedSqrtRatioLimit(params: {
    amount: TokenAmount;
    isToken1: boolean;
  }): bigint {
    return this.node.suggestedSqrtRatioLimit(params);
  }
}
