import {
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
  TokenAmount,
} from "./quoteNode";
import getSetBits from "../math/getSetBits";
import { isPriceIncreasing } from "../math/swap";

export interface CachingSplittingQuoteNodeOptions<T> {
  readonly maxSplits?: number;

  resourcesReducer(memo: T, value: T): T;
}

interface Cache<T> {
  [bit: number]: {
    result: Quote<T>;
    cache: Cache<T>;
  };
}

export class CachingSplittingQuoteNode<T> implements QuoteNode<T> {
  private readonly node: QuoteNode<T>;
  private readonly options: CachingSplittingQuoteNodeOptions<T>;
  private readonly cache: Cache<T>;

  constructor(
    node: QuoteNode<T>,
    options: CachingSplittingQuoteNodeOptions<T>
  ) {
    this.node = node;
    this.options = options;
    this.cache = {};
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
      // double the significance of the least significant bit so we always quote a larger amount
      bits[bits.length - 1] += 1;
      // combine duplicates of bits
      while (
        bits.length > 1 &&
        bits[bits.length - 1] === bits[bits.length - 2]
      ) {
        bits.pop();
        bits[bits.length - 1] += 1;
      }
    }

    const isIncreasing = isPriceIncreasing(
      params.amount.amount,
      params.amount.token === this.key.token1
    );

    // start by quoting 0
    let quote = this.node.quote({ ...params, amount: { amount: 0n, token } });
    let cache = this.cache;

    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];

      // return early if we hit the limit
      if (quote.stateAfter.sqrtRatio === params.sqrtRatioLimit) {
        return quote;
      }

      const cacheKey = isOutput ? -b : b;

      let partQuote: Quote<T>;
      let nextCache: Cache<T>;
      if (cache[cacheKey]) {
        partQuote = cache[cacheKey].result;
        nextCache = cache[cacheKey].cache;
      } else {
        const magnitude = 1n << BigInt(b);
        partQuote = this.node.quote({
          amount: {
            token,
            amount: isOutput ? -magnitude : magnitude,
          },
          overrideSwapState: quote.stateAfter,
        });

        nextCache = {};
        cache[cacheKey] = {
          result: partQuote,
          cache: nextCache,
        };
      }

      if (
        params.sqrtRatioLimit &&
        partQuote.stateAfter.sqrtRatio !== params.sqrtRatioLimit &&
        partQuote.stateAfter.sqrtRatio > params.sqrtRatioLimit === isIncreasing
      ) {
        const magnitude = 1n << BigInt(b);
        partQuote = this.node.quote({
          amount: {
            token,
            amount: isOutput ? -magnitude : magnitude,
          },
          overrideSwapState: quote.stateAfter,
          sqrtRatioLimit: params.sqrtRatioLimit,
        });
        // we need to make this assertion because the following iterations need to return early so they don't touch the cache
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
      cache = nextCache;
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
