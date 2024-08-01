import { describe, expect, it } from "vitest";
import { splitTwammOrder, TwammSaleRateDeltaMap } from "./splitOrder";
import { TwammPoolStateQueryResult } from "../../queries";
import { MAX_TICK_SPACING, toSqrtRatio, TwammPool } from "@ekubo/sdk";

const BASE_POOL_STATE = {
  token0: "0",
  token1: "1",
  tick_spacing: MAX_TICK_SPACING.toString(),
  extension: "1",
  sqrt_ratio: toSqrtRatio(1).toString(),
  tick: 1,
  last_event_id: "1",
  last_liquidity_update_event_id: "1",
};

type TwammOrderSplitTestCase = {
  description: string;
  amount: bigint;
  poolStates: TwammPoolStateQueryResult[];
  orderData: TwammSaleRateDeltaMap;
  maxSplits: number;
  startTime?: number;
  endTime?: number;
  averageBlockTime?: bigint;
};

const FAIL_TEST_CASES: TwammOrderSplitTestCase[] = [
  {
    description: "no pools",
    amount: 100n,
    poolStates: [],
    orderData: {},
    maxSplits: 0,
  },
];

const TEST_CASES: TwammOrderSplitTestCase[] = [
  {
    description: "one pool",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 0,
  },
  {
    description: "two pools, same liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "two pools, one with no liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n * 10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n * 10n ** 18n) << 32n).toString(),
        liquidity: "0",
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "two pools, one with 10x liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n * 10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "two pools, same liquidity, different rates, maxSplits 1",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((2n * 10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description: "three pools, same liquidity, maxSplits 2",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "3",
        fee: ((3n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 1,
  },
  {
    description:
      "three pools, same liquidity, diff sale rate changes, maxSplits 2",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "3",
        fee: ((3n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {
      "1": [
        {
          saleRateDelta0: 0n,
          saleRateDelta1: (10n ** 18n) << 32n,
          time: Math.floor(new Date().getTime() / 1000) - 8,
        },
      ],
      "2": [
        {
          saleRateDelta0: (10n ** 18n) << 32n,
          saleRateDelta1: 0n,
          time: Math.floor(new Date().getTime() / 1000) - 8,
        },
      ],
    },
    maxSplits: 2,
  },
  {
    description:
      "two pools, same liquidity, token1 sale rate change for one pool",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {
      "2": [
        {
          saleRateDelta0: 0n,
          saleRateDelta1: (10n ** 18n) << 32n,
          time: Math.floor(new Date().getTime() / 1000) - 8,
        },
      ],
    },
    maxSplits: 1,
  },
  {
    description:
      "two pools, same liquidity, same token1 sale rate change for both pools",
    amount: 10n ** 18n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "1",
        fee: ((1n << 128n) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        pool_key_hash: "2",
        fee: ((2n * (1n << 128n)) / 100n).toString(),
        token0_sale_rate: ((10n ** 18n) << 32n).toString(),
        token1_sale_rate: ((10n ** 18n) << 32n).toString(),
        liquidity: (10n ** 18n).toString(),
        last_execution_time: new Date(
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000,
        ),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {
      "1": [
        {
          saleRateDelta0: 0n,
          saleRateDelta1: (10n ** 18n) << 32n,
          time: Math.floor(new Date().getTime() / 1000) - 8,
        },
      ],
      "2": [
        {
          saleRateDelta0: 0n,
          saleRateDelta1: (10n ** 18n) << 32n,
          time: Math.floor(new Date().getTime() / 1000) - 8,
        },
      ],
    },
    maxSplits: 1,
  },
  {
    description: "large order, low liquidity",
    amount: 500000000000000000000n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        sqrt_ratio: "20115707210836371440643082733748318",
        pool_key_hash: "1",
        fee: "170141183460469235273462165868118016",
        token0_sale_rate: "48937788591662159467612",
        token1_sale_rate: "2965175852272",
        liquidity: "471301423774311",
        last_execution_time: new Date(1712926794 * 1000),
      } as TwammPoolStateQueryResult,
      {
        ...BASE_POOL_STATE,
        sqrt_ratio: "19935289412774841282963644059611099",
        pool_key_hash: "2",
        fee: "170141183460469235273462165868118016",
        token0_sale_rate: "17338971587284926485",
        token1_sale_rate: "0",
        liquidity: "3184484315910",
        last_execution_time: new Date(1712926794 * 1000),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {},
    maxSplits: 6,
    startTime: 1712927040,
    endTime: 1713897472,
    averageBlockTime: 336n,
  },
];

describe(splitTwammOrder, () => {
  describe("failure cases", async () => {
    const defaultStartTime = Math.floor(Date.now() / 1000);
    const defaultEndTime = defaultStartTime + Number(16);
    const defaultAverageBlockTime = 1n;

    for (const testCase of FAIL_TEST_CASES) {
      const { description, amount, poolStates, orderData, maxSplits } =
        testCase;

      const startTime = testCase?.startTime ?? defaultStartTime;
      const endTime = testCase?.endTime ?? defaultEndTime;
      const averageBlockTime =
        testCase?.averageBlockTime ?? defaultAverageBlockTime;

      let pools: TwammPool[] = [];

      for (const pool of poolStates) {
        pools.push(
          new TwammPool({
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
          }),
        );
      }

      for (const isToken1 of [false, true]) {
        it(`${description}, token${isToken1 ? "1" : "0"}`, () => {
          expect(() =>
            splitTwammOrder({
              amount,
              startTime,
              endTime,
              isToken1,
              pools,
              maxSplits,
              realStartTime: startTime,
              averageBlockTime: 360,
            }),
          ).toThrowError();
        });
      }
    }
  });

  describe("various pools", async () => {
    const defaultStartTime = Math.floor(Date.now() / 1000);
    const defaultEndTime = defaultStartTime + Number(16);
    const defaultAverageBlockTime = 1n;

    for (const testCase of TEST_CASES) {
      const { description, amount, poolStates, orderData, maxSplits } =
        testCase;

      const startTime = testCase?.startTime ?? defaultStartTime;
      const endTime = testCase?.endTime ?? defaultEndTime;

      let pools: TwammPool[] = [];

      for (const pool of poolStates) {
        pools.push(
          new TwammPool({
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
          }),
        );
      }

      for (const isToken1 of [false, true]) {
        const orders = splitTwammOrder({
          amount,
          startTime,
          endTime,
          isToken1,
          pools,
          maxSplits,
          realStartTime: startTime,
          averageBlockTime: 360,
        });
        it(`${description}, token${isToken1 ? "1" : "0"}`, () => {
          expect(
            orders.map(({ amount, node }) => {
              return {
                amount,
                fee: node.key.fee,
              };
            }),
          ).toMatchSnapshot();

          if (orders.length > 0) {
            const ordersAmount = orders.reduce(
              (acc, curr) => acc + curr.amount,
              0n,
            );
            expect(ordersAmount === amount).toBeTruthy();
          }
        });
      }
    }
  });
});
