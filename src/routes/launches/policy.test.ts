import { expect, test } from "bun:test";
import {
  feeSchedule,
  LOCAL_INSTANCES,
  supportedInstances,
  supportedLaunch,
} from "./policy";
import { ClaimPage, LaunchDetail, LaunchList, SwapPage } from "./schema";

test("local instance manifests bind every constructor/runtime/ABI field", () => {
  expect(supportedInstances(LOCAL_INSTANCES, true)).toEqual(LOCAL_INSTANCES);
  expect(supportedInstances(LOCAL_INSTANCES, false)).toEqual([]);
  expect(supportedInstances([], true)).toEqual([]);
  for (const pin of LOCAL_INSTANCES) {
    for (const key of Object.keys(pin) as (keyof typeof pin)[]) {
      expect(
        supportedInstances([{ ...pin, [key]: "unreviewed" }], true),
      ).toEqual([]);
    }
    expect(supportedLaunch(pin, LOCAL_INSTANCES)).toBe(true);
    for (const key of ["chainId", "address", "core", "quote"] as const) {
      expect(
        supportedLaunch({ ...pin, [key]: "unreviewed" }, LOCAL_INSTANCES),
      ).toBe(false);
    }
    expect(supportedLaunch(pin, [])).toBe(false);
  }
});

const input = {
  start: 1000n,
  duration: 3n,
  initial: 10n,
  final: 3n,
  indexedTime: 999n,
};
test("fee phases and floor decrement use indexed time only", () => {
  const cases = [
    [999n, "before_trading_start", "10"],
    [1000n, "fee_decay", "10"],
    [1001n, "fee_decay", "8"],
    [1002n, "fee_decay", "6"],
    [1003n, "final_fee", "3"],
    [1000000000n, "final_fee", "3"],
  ] as const;
  for (const [indexedTime, phase, rate] of cases) {
    const result = feeSchedule({ ...input, indexedTime });
    expect(result.phase).toBe(phase);
    expect(result.fee_rate).toBe(rate);
    expect(result.evaluated_at).toBe(Number(indexedTime));
  }
});

test("invalid indexed domains fail, never coerce or overflow", () => {
  for (const change of [
    { start: -1n },
    { duration: 0n },
    { final: 11n },
    { initial: 1n << 64n },
    { indexedTime: -1n },
    { start: (1n << 64n) - 1n },
    { indexedTime: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
  ]) {
    expect(() => feeSchedule({ ...input, ...change })).toThrow();
  }
});

test("frozen schemas expose no staged status/stats/exhausted fields", () => {
  const empty = {
    schema_version: "zero-seed-launch-api/v1",
    as_of: {
      block_number: "1",
      block_hash: `0x${"a".repeat(64)}`,
      block_time: 1000,
    },
    data: [],
    next_cursor: null,
  };
  expect(LaunchList.safeParse(empty).success).toBe(true);
  expect(LaunchList.safeParse({ ...empty, status: "ended" }).success).toBe(false);
  for (const schema of [SwapPage, ClaimPage]) {
    expect(
      schema.safeParse({
        ...empty,
        chain_id: "31337",
        pool_id: `0x${"b".repeat(64)}`,
      }).success,
    ).toBe(true);
  }
  expect(Object.keys(LaunchDetail.shape)).not.toContain("status");
  expect(Object.keys(LaunchDetail.shape.inventory.shape)).not.toContain(
    "exhausted",
  );
});
