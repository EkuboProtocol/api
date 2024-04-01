import { describe, expect, it } from "vitest";
import Decimal from "decimal.js-light";
import {
  TwammSaleRateDeltaMap,
  splitTwammOrderByPriceImpact,
} from "./splitOrder";
import { TwammPoolStateQueryResult } from "../../queries";
import { MAX_TICK_SPACING, toSqrtRatio } from "../quote/math/tick";
import { TwammPool } from "../quote/nodes/twammPool";

const DURATION = 16n;

const BASE_POOL_STATE = {
  token0: "0",
  token1: "1",
  tick_spacing: MAX_TICK_SPACING.toString(),
  extension: "1",
  sqrt_ratio: toSqrtRatio(1).toString(),
  tick: 1,
  last_event_id: "1",
};

const TEST_CASES: {
  description: string;
  amount: bigint;
  poolStates: TwammPoolStateQueryResult[];
  orderData: TwammSaleRateDeltaMap;
  maxSplits: number;
}[] = [
  {
    description: "one pool",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: "1",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "two pools, same liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: "1",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: "2",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 2,
  },
  {
    description: "two pools, one with 10x liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: "1",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: "2",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n * 10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 2,
  },
  {
    description: "two pools, same liquidity, different rates, maxSplits 1",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: "1",
        token0_sale_rate: ((2n * 10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: "2",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "three pools, one with 10x liquidity, maxSplits 2",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: "1",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: "2",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n * 10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "3",
        fee: "3",
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (5n * 10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 2,
  },
];

describe.only(splitTwammOrderByPriceImpact, () => {
  describe("various pools", async () => {
    const startTime = new Date();
    const endTime = new Date(new Date().getTime() + Number(DURATION * 1_000n));

    for (const testCase of TEST_CASES) {
      const { description, amount, poolStates, orderData, maxSplits } =
        testCase;

      let twammNodes: { [key_hash: string]: TwammPool } = {};

      for (const pool of poolStates) {
        twammNodes[pool.pool_key_hash] = new TwammPool({
          token0: BigInt(pool.token0),
          token1: BigInt(pool.token1),
          sqrtRatio: BigInt(pool.sqrt_ratio),
          fee: BigInt(pool.fee),
          liquidity: BigInt(pool.liquidity),
          tick: pool.tick,
          extension: BigInt(pool.extension),
          lastExecutionTime: pool.last_execution_time.getTime() / 1000,
          saleRateDeltas: orderData[pool.pool_key_hash] ?? [],
          token0SaleRate: BigInt(pool.token0_sale_rate),
          token1SaleRate: BigInt(pool.token1_sale_rate),
        });
      }

      it(description, async () => {
        const orders = await splitTwammOrderByPriceImpact({
          amount,
          startTime,
          endTime,
          isToken1: false,
          maxSplits,
          twammNodes,
        });

        expect(orders).toMatchSnapshot();

        let decimalAmount = new Decimal(amount.toString());
        if (orders.length > 0) {
          const ordersAmount = orders.reduce(
            (acc, curr) => acc.add(curr.amount),
            new Decimal(0)
          );
          expect(ordersAmount.eq(decimalAmount)).toBeTruthy();
        }
      });
    }
  });
});
