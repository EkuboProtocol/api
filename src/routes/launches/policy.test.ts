import { expect, test } from "bun:test";
import {
  decayedFee,
  feeSchedule,
  powQ64,
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
  // 2^63: b^t = 2^(64-t), E = 2^61, so the excess is floor(7 * (2^(64-t) - 2^61) / (2^64 - 2^61)).
  decayFactor: 1n << 63n,
  indexedTime: 999n,
};
test("fee phases and the normalized exponential use indexed time only", () => {
  const cases = [
    [999n, "before_trading_start", "10"],
    [1000n, "fee_decay", "10"],
    [1001n, "fee_decay", "6"],
    [1002n, "fee_decay", "4"],
    [1003n, "final_fee", "3"],
    [1000000000n, "final_fee", "3"],
  ] as const;
  for (const [indexedTime, phase, rate] of cases) {
    const result = feeSchedule({ ...input, indexedTime });
    expect(result.phase).toBe(phase);
    expect(result.fee_rate).toBe(rate);
    expect(result.decay_factor).toBe((1n << 63n).toString());
    expect(result.evaluated_at).toBe(Number(indexedTime));
  }
});

// Contract vectors at evm-contracts b1cbb1c1 (test/vectors/zero-seed-launch.json):
// fixture 5% -> 0.3%, start 1000, study factors for D=3600 and D=600.
test("schedule reproduces the contract fee rows and chord counterexamples", () => {
  const factors: Record<string, bigint> = {
    "3600": 18425445863997925462n,
    "600": 18319323104848571946n,
  };
  const rows = [
    ["3600", 0n, 922337203685477580n],
    ["3600", 1n, 921320298688452636n],
    ["3600", 1800n, 151673229050500749n],
    ["3600", 3599n, 55356139728168999n],
    ["3600", 3600n, 55340232221128654n],
    ["600", 1n, 916253358061131122n],
    ["600", 300n, 151673229050500755n],
    ["600", 599n, 55435953504208715n],
    ["600", 600n, 55340232221128654n],
  ] as const;
  for (const [duration, t, fee] of rows)
    expect(
      decayedFee(
        922337203685477580n,
        55340232221128654n,
        factors[duration],
        BigInt(duration),
        t,
      ),
    ).toBe(fee);
  // Nearly flat factors lie above the integer linear chord; reproduced, not corrected.
  const exceptions = [
    [
      18446744073692774400n,
      600n,
      561n,
      6145946118234823704n,
      3773859608321006899n,
      3928045231480721956n,
    ],
    [
      18446744073675997184n,
      600n,
      596n,
      18262276632972456099n,
      16093730704593406921n,
      16108187677454293848n,
    ],
    [
      18446744073709551608n,
      4294967295n,
      4197406844n,
      18446744073709551615n,
      18012629042273719369n,
      18022489992398216608n,
    ],
    [
      18446744073709551608n,
      4294967295n,
      4028198074n,
      18446744073709551615n,
      14193599660735192734n,
      14457771176879541746n,
    ],
    [
      18446744073709551608n,
      4294967295n,
      4074259523n,
      18446744073709551615n,
      11939927239388337278n,
      12274296501798491214n,
    ],
  ] as const;
  for (const [factor, duration, t, initial, final, fee] of exceptions)
    expect(decayedFee(initial, final, factor, duration, t)).toBe(fee);
  expect(powQ64(12345n, 0n)).toBe(1n << 64n);
});

// SHA-256 chains h = sha256(h || fee as 8-byte big-endian) over every second t = 0..D, pinned in the
// contract vectors (fee_curve.all_second_digests_sha256); 25,212 evaluations in total.
test("every second of both study schedules at six rates matches the contract digests", () => {
  const rates: Record<string, bigint> = {
    "5": 922337203685477580n,
    "50": 9223372036854775808n,
    "75": 13835058055282163712n,
    "90": 16602069666338596454n,
    "99": 18262276632972456099n,
    max: 18446744073709551615n,
  };
  const digests: [bigint, bigint, Record<string, string>][] = [
    [
      600n,
      18319323104848571946n,
      {
        "5": "6346e95d7a66797ce3270ff25d5fc19e64c2e9ccabf1c2dbc03a946276fe64b5",
        "50": "73b08ebf1a8d045805ec42c84200bbd841e25e515a1aef7f7fb6d246c6b6027a",
        "75": "ac34495b80e94c660319b488c697f7ecf05af9eeb3f4a03c27c1b7bc79d4e5f4",
        "90": "87c5e5119e29faddc71e59753cca77fea297b4d76419fd0b66a78a340c4b7cef",
        "99": "af32943cbe63a0991532e385ad42960e1ce4040d59981ca6d4a4d4b86dc20cb0",
        max: "dce005ce818ddc4248d259c7a6e2b9c0652cb4b4705b70cf9f4f04f1270023af",
      },
    ],
    [
      3600n,
      18425445863997925462n,
      {
        "5": "306aaf4b3acfabe5ba98a1ee86cf91ba6564e010f806d1f592f3a403620bfd77",
        "50": "ac4fa207bb2beec03e9a122e5839482d14abb55c72a4b65c155da02ea15baf51",
        "75": "c7eaeb00462cc16f7ce3684309604d97a9a22a1eaec15a1b8862bbfd68705771",
        "90": "fb0df6da40ddcacfe08f4a599b3078a1e6dbe0017b97e73b6b4e384563247354",
        "99": "ee35ebedb9d7c09c69675d9517cdc1dc26e177eb61e0aa76fd13eb63dee8cba8",
        max: "82e00f48c0d5dc03d757e417a60a410a8ee9cfd0d41c12cfb72547bfc73ac4f7",
      },
    ],
  ];
  let checked = 0;
  for (const [duration, factor, byRate] of digests) {
    for (const [label, rate] of Object.entries(rates)) {
      let chain = new Uint8Array(32);
      for (let t = 0n; t <= duration; t++) {
        const fee = decayedFee(rate, 55340232221128654n, factor, duration, t);
        const word = new Uint8Array(40);
        word.set(chain);
        new DataView(word.buffer).setBigUint64(32, fee);
        chain = new Uint8Array(
          new Bun.CryptoHasher("sha256").update(word).digest(),
        );
        checked++;
      }
      expect(Buffer.from(chain).toString("hex")).toBe(byRate[label]);
    }
  }
  expect(checked).toBe(25_212);
});

test("invalid indexed domains fail, never coerce or overflow", () => {
  for (const change of [
    { start: -1n },
    { duration: 0n },
    { final: 11n },
    { decayFactor: 0n },
    { decayFactor: 1n << 64n },
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
    schema_version: "zero-seed-launch-api/v2",
    as_of: {
      block_number: "1",
      block_hash: `0x${"a".repeat(64)}`,
      block_time: 1000,
    },
    data: [],
    next_cursor: null,
  };
  expect(LaunchList.safeParse(empty).success).toBe(true);
  expect(LaunchList.safeParse({ ...empty, status: "ended" }).success).toBe(
    false,
  );
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
