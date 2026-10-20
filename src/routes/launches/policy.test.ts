import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  DECAY_TABLE_Q128,
  DECAY_ZERO_FROM,
  decayQ128,
  decayedFee,
  feeSchedule,
  LOCAL_INSTANCES,
  supportedInstances,
  supportedLaunch,
} from "./policy";
import {
  ClaimPage,
  LaunchDetail,
  LaunchList,
  OwnerPage,
  SwapPage,
} from "./schema";

test("local instance manifests bind every constructor/runtime/ABI/periphery field", () => {
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
    for (const key of [
      "chainId",
      "address",
      "periphery",
      "core",
      "quote",
      "quoteKind",
    ] as const) {
      expect(
        supportedLaunch({ ...pin, [key]: "unreviewed" }, LOCAL_INSTANCES),
      ).toBe(false);
    }
    expect(supportedLaunch(pin, [])).toBe(false);
  }
});

test("native and ERC-20 quote provenance stay distinct", () => {
  const [native, weth] = LOCAL_INSTANCES;
  expect([native.quote, native.quoteKind, native.quoteRuntime]).toEqual([
    "0x0000000000000000000000000000000000000000",
    "native",
    null,
  ]);
  expect(weth.quoteKind).toBe("erc20");
  expect(weth.quoteRuntime).toMatch(/^0x[0-9a-f]{64}$/);
  // relabelling either kind, or giving native ETH a runtime, is unreviewed
  expect(supportedInstances([{ ...native, quoteKind: "erc20" }], true)).toEqual(
    [],
  );
  expect(
    supportedInstances([{ ...native, quoteRuntime: weth.quoteRuntime }], true),
  ).toEqual([]);
  expect(
    supportedLaunch({ ...weth, quoteKind: "native" }, LOCAL_INSTANCES),
  ).toBe(false);
});

const input = {
  start: 1000n,
  duration: 3600n,
  initial: 9223372036854775808n,
  final: 55340232221128654n,
  indexedTime: 999n,
};
test("fee phases use indexed time only; 50% -> 0.3% over 3600 s", () => {
  const cases = [
    [999n, "before_trading_start", "9223372036854775808"],
    [1000n, "fee_decay", "9223372036854775808"],
    [4599n, "fee_decay", null],
    [4600n, "final_fee", "55340232221128654"],
    [1000000000n, "final_fee", "55340232221128654"],
  ] as const;
  for (const [indexedTime, phase, rate] of cases) {
    const result = feeSchedule({ ...input, indexedTime });
    expect(result.phase).toBe(phase);
    if (rate) expect(result.fee_rate).toBe(rate);
    expect(result.decay).toEqual({
      kind: "fixed_base_q128",
      half_life_seconds: 600,
    });
    expect(result.evaluated_at).toBe(Number(indexedTime));
  }
  // halvings: 600 s past the start the unscaled decay is exactly 2^127 - 1
  expect(decayQ128(600n)).toBe((1n << 127n) - 1n);
});

const vectorsDir = resolve(import.meta.dir, "vectors");

// The protocol's independent vectors (250-digit Decimal generator, not this
// code): every second 0..D of 12 curves, rates 5/50/75/90/99/max% and
// durations 600/3600 s, [initial, final, duration, elapsed, fee].
test("decayedFee reproduces all 25,212 independent all-second vectors and the manifest digests", () => {
  const rows = JSON.parse(
    gunzipSync(
      readFileSync(resolve(vectorsDir, "fee-curve-all-seconds.json.gz")),
    ).toString("utf8"),
  ) as [string, string, string, string, string][];
  expect(rows.length).toBe(25_212);
  const chains = new Map<string, Uint8Array>();
  for (const [initial, final, duration, elapsed, fee] of rows) {
    const actual = decayedFee(
      BigInt(initial),
      BigInt(final),
      BigInt(duration),
      BigInt(elapsed),
    );
    if (actual.toString() !== fee)
      throw new Error(`${initial} ${duration} ${elapsed}: ${actual} != ${fee}`);
    // h = sha256(h || fee as 8-byte big-endian), in elapsed order
    const key = `${duration}:${initial}`;
    const word = new Uint8Array(40);
    word.set(chains.get(key) ?? new Uint8Array(32));
    new DataView(word.buffer).setBigUint64(32, actual);
    chains.set(
      key,
      new Uint8Array(new Bun.CryptoHasher("sha256").update(word).digest()),
    );
  }
  const vectors = JSON.parse(
    readFileSync(resolve(vectorsDir, "fee-decay-vectors.json"), "utf8"),
  ) as {
    table_q128: string[];
    zero_at_or_above: number;
    decay_samples: { t: number; decay_q128: string }[];
    fee_rows: {
      initial: string;
      final: string;
      duration: number;
      elapsed: number;
      fee: string;
    }[];
    all_second_digests_sha256: Record<string, Record<string, string>>;
  };
  const rates: Record<string, string> = {
    "5": "922337203685477580",
    "50": "9223372036854775808",
    "75": "13835058055282163712",
    "90": "16602069666338596454",
    "99": "18262276632972456099",
    max: "18446744073709551615",
  };
  // the manifest lists 12 digests; this file carries the five above 5%
  let digests = 0;
  for (const [duration, byRate] of Object.entries(
    vectors.all_second_digests_sha256,
  ))
    for (const [label, digest] of Object.entries(byRate)) {
      expect(
        Buffer.from(chains.get(`${duration}:${rates[label]}`)!).toString("hex"),
      ).toBe(digest);
      digests++;
    }
  expect(digests).toBeGreaterThanOrEqual(10);
  expect(DECAY_TABLE_Q128.map(String)).toEqual(vectors.table_q128);
  expect(DECAY_ZERO_FROM).toBe(BigInt(vectors.zero_at_or_above));
  for (const { t, decay_q128 } of vectors.decay_samples)
    expect(decayQ128(BigInt(t)).toString()).toBe(decay_q128);
  for (const r of vectors.fee_rows)
    expect(
      decayedFee(
        BigInt(r.initial),
        BigInt(r.final),
        BigInt(r.duration),
        BigInt(r.elapsed),
      ).toString(),
    ).toBe(r.fee);
});

test("invalid indexed domains fail, never coerce or overflow", () => {
  for (const change of [
    { start: -1n },
    { duration: 0n },
    { duration: 1n << 32n },
    { final: input.initial + 1n },
    { initial: 1n << 64n },
    { indexedTime: -1n },
    { start: (1n << 64n) - 1n },
    { indexedTime: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
  ]) {
    expect(() => feeSchedule({ ...input, ...change })).toThrow();
  }
  expect(() => decayQ128(-1n)).toThrow();
});

test("frozen schemas expose no staged status/stats/exhausted or decay-factor fields", () => {
  const empty = {
    schema_version: "zero-seed-launch-api/v3",
    as_of: {
      block_number: "1",
      block_hash: `0x${"a".repeat(64)}`,
      block_time: 1000,
    },
    data: [],
    next_cursor: null,
  };
  expect(LaunchList.safeParse(empty).success).toBe(true);
  expect(
    LaunchList.safeParse({
      ...empty,
      schema_version: "zero-seed-launch-api/v2",
    }).success,
  ).toBe(false);
  expect(LaunchList.safeParse({ ...empty, status: "ended" }).success).toBe(
    false,
  );
  for (const schema of [SwapPage, ClaimPage, OwnerPage]) {
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
  expect(Object.keys(LaunchDetail.shape.fee_schedule.shape)).not.toContain(
    "decay_factor",
  );
});
