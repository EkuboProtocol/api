import Decimal from "decimal.js-light";
import { TwammExtensionPoolState, splitTWAMMOrder } from "./splitOrder";

const DURATION = 16n;

const TEST_CASES: {
  description: string;
  amount: bigint;
  poolStates: TwammExtensionPoolState[];
  maxSplits: number;
}[] = [
  {
    description: "one pool",
    amount: 10n ** 18n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
    ],
    maxSplits: 1,
  },
  {
    description: "two pools, same liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
    ],
    maxSplits: 2,
  },
  {
    description: "two pools, one with 4x liquidity",
    amount: 10n ** 18n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 4n * (10n ** 18n),
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: (10n ** 18n),
      },
    ],
    maxSplits: 2,
  },
  {
    description: "three pools, one with 4x liquidity, maxSplits 2",
    amount: 10n ** 18n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 4n * 10n ** 18n,
      },
      {
        key_hash: "0",
        fee: 0,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
    ],
    maxSplits: 2,
  },
  {
    description: "two pools, same liquidity, different rates, maxSplits 1",
    amount: 10n ** 18n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
    ],
    maxSplits: 1,
  },
  {
    description: "two pools, same liquidity, maxSplits 2, check rounding",
    amount: (10n ** 18n) + 1n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 100n * 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 100n * 10n ** 18n,
      },
    ],
    maxSplits: 2,
  },
  {
    description: "three pools, diff liquidity, maxSplits 3, check rounding",
    amount: 10n ** 18n + 1n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 2n * 10n ** 18n,
      },
      {
        key_hash: "0",
        fee: 3,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: (10n ** 18n) * DURATION,
        liquidity: 3n * 10n ** 18n,
      },
    ],
    maxSplits: 3,
  },
  {
    description: "three pools, diff liquidity, maxSplits 3, check rounding",
    amount: 2n * 10n ** 18n + 1n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 2n * 10n ** 18n,
      },
      {
        key_hash: "0",
        fee: 3,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 3n * 10n ** 18n,
      },
    ],
    maxSplits: 3,
  },
  {
    description: "three pools, diff liquidity, maxSplits 3, check rounding",
    amount: 100n * (10n ** 18n) + 1n,
    poolStates: [
      {
        key_hash: "0",
        fee: 1,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 10n ** 18n,
      },
      {
        key_hash: "1",
        fee: 2,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 2n * 10n ** 18n,
      },
      {
        key_hash: "0",
        fee: 3,
        token0_sold_amount: 10n * (10n ** 18n) * DURATION,
        token1_sold_amount: 10n * (10n ** 18n) * DURATION,
        liquidity: 3n * 10n ** 18n,
      },
    ],
    maxSplits: 3,
  },
];

describe(splitTWAMMOrder, () => {
  it("no pools", async () => {
    const amount: bigint = 0n;
    const startTime: Date = new Date();
    const endTime: Date = new Date();
    const poolStates: TwammExtensionPoolState[] = [];
    const maxSplits: number = 2;
    expect(
      await splitTWAMMOrder(amount, startTime, endTime, poolStates, maxSplits),
    ).toEqual([]);
  });

  describe("various pools", async () => {
    const baseOrderKey = {
      start_time: new Date(),
      end_time: new Date(new Date().getTime() + Number(DURATION * 1_000n)),
    };

    for (const testCase of TEST_CASES) {
      const { description, amount, poolStates, maxSplits } = testCase;

      it(description, async () => {
        const orders = await splitTWAMMOrder(
          amount,
          baseOrderKey.start_time,
          baseOrderKey.end_time,
          poolStates,
          maxSplits,
        );

        expect(orders).toMatchSnapshot();

        let decimalAmount = new Decimal(amount.toString());
        if (orders.length > 0) {
          const ordersAmount = orders.reduce(
            (acc, curr) => acc.add(curr.amount),
            new Decimal(0),
          );
          expect(ordersAmount.eq(decimalAmount)).toBeTruthy();
        }
      });
    }
  });
});
