import { describe, expect, it } from "vitest";
import { TwammSaleRateDeltaMap, splitTwammOrder } from "./splitOrder";
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

type TwammOrderSplitTestCase = {
  description: string;
  amount: bigint;
  poolStates: TwammPoolStateQueryResult[];
  orderData: TwammSaleRateDeltaMap;
  maxSplits: number;
  startTime?: number;
  endTime?: number;
};

const FAIL_TEST_CASES: TwammOrderSplitTestCase[] = [
  {
    description: "no pools",
    amount: 100n,
    poolStates: [],
    orderData: {},
    maxSplits: 0,
  },
  {
    description: "negative amount edge case, max split 0, filter out pool",
    amount: 100n,
    poolStates: [
      {
        ...BASE_POOL_STATE,
        sqrt_ratio: "16988185698248224601569110190524726",
        pool_key_hash: "1",
        fee: "170141183460469235273462165868118016",
        token0_sale_rate: "2883988461929862547097",
        token1_sale_rate: "0",
        liquidity: "2404617496284",
        last_execution_time: new Date(1712077649 * 1000),
      } as TwammPoolStateQueryResult,
    ],
    orderData: {
      "1": [
        {
          time: 1712091136,
          saleRateDelta0: -1993116755301870156387n,
          saleRateDelta1: 0n,
        },
        {
          time: 1712123904,
          saleRateDelta0: -808951706627992390710n,
          saleRateDelta1: 0n,
        },
        {
          time: 1712586752,
          saleRateDelta0: -81920000000000000000n,
          saleRateDelta1: 0n,
        },
      ],
    },
    maxSplits: 0,
    startTime: 1712346815,
    endTime: 1712424832,
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
          (Math.floor(new Date().getTime() / 1000) - 16) * 1000
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
];

describe(splitTwammOrder, () => {
  describe("failure cases", async () => {
    const defaultStartTime = Math.floor(Date.now() / 1000);
    const defaultEndTime = defaultStartTime + Number(DURATION);

    for (const testCase of FAIL_TEST_CASES) {
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
          })
        );
      }

      for (const isToken1 of [false, true]) {
        it(`${description}, token${isToken1 ? "1" : "0"}`, () => {
          expect(() =>
            splitTwammOrder(
              amount,
              startTime,
              endTime,
              isToken1,
              pools,
              maxSplits
            )
          ).toThrowError("Invalid order split");
        });
      }
    }
  });

  describe("various pools", async () => {
    const defaultStartTime = Math.floor(Date.now() / 1000);
    const defaultEndTime = defaultStartTime + Number(DURATION);

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
          })
        );
      }

      for (const isToken1 of [false, true]) {
        const { orders, priceImpact } = splitTwammOrder(
          amount,
          startTime,
          endTime,
          isToken1,
          pools,
          maxSplits
        );
        it(`${description}, token${isToken1 ? "1" : "0"}`, () => {
          expect(
            orders.map(({ amount, node, otherTokenAmount }) => {
              return {
                amount,
                otherTokenAmount,
                fee: node.key.fee,
              };
            })
          ).toMatchSnapshot();

          if (orders.length > 0) {
            const ordersAmount = orders.reduce(
              (acc, curr) => acc + curr.amount,
              0n
            );
            expect(ordersAmount === amount).toBeTruthy();
          }
        });

        it(`${description}, token${isToken1 ? "1" : "0"} - priceImpact`, () => {
          expect(priceImpact).toMatchSnapshot();
        });
      }
    }
  });
});
