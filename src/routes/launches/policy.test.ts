import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  DECAY_TABLE_Q128,
  DECAY_ZERO_FROM,
  decayQ128,
  decayedFee,
  decayRateForHalfLife,
  feeSchedule,
  halfLifeSeconds,
  HALF_LIFE_X32_E30,
  MAX_DECAY_PRODUCT,
  tickFactorQ128,
  tickRateDecayedFee,
  launchSupply,
  LOCAL_INSTANCES,
  LOCAL_QUOTES,
  supportedInstances,
  supportedLaunch,
  supportedQuotes,
} from "./policy";
import {
  ClaimPage,
  FeeSchedule,
  LaunchDetail,
  LaunchList,
  LaunchSummary,
  OwnerPage,
  SwapPage,
} from "./schema";

const NATIVE = "0x0000000000000000000000000000000000000000";

test("local instance manifests bind every runtime/ABI/periphery/Core field and carry no quote", () => {
  expect(supportedInstances(LOCAL_INSTANCES, true)).toEqual(LOCAL_INSTANCES);
  expect(supportedInstances(LOCAL_INSTANCES, false)).toEqual([]);
  expect(supportedInstances([], true)).toEqual([]);
  expect(LOCAL_INSTANCES.map((pin) => pin.feeModel)).toEqual([
    "fixed_base_duration_v1",
    "tick_rate_v2",
  ]);
  for (const pin of LOCAL_INSTANCES) {
    expect(Object.keys(pin).some((key) => /quote/i.test(key))).toBe(false);
    for (const key of Object.keys(pin) as (keyof typeof pin)[]) {
      expect(
        supportedInstances([{ ...pin, [key]: "unreviewed" }], true),
      ).toEqual([]);
    }
    const native = { ...pin, quote: NATIVE, quoteKind: "native" as const };
    expect(supportedLaunch(native, LOCAL_INSTANCES, [])).toBe(true);
    for (const key of [
      "chainId",
      "feeModel",
      "address",
      "periphery",
      "core",
    ] as const) {
      expect(
        supportedLaunch(
          { ...native, [key]: "unreviewed" },
          LOCAL_INSTANCES,
          LOCAL_QUOTES,
        ),
      ).toBe(false);
    }
    expect(supportedLaunch(native, [], LOCAL_QUOTES)).toBe(false);
  }
});

test("quote support is per launch: native, or a reviewed ERC-20 by chain/address/runtime", () => {
  const [pin] = LOCAL_INSTANCES;
  const [token] = LOCAL_QUOTES;
  expect([token.chainId, token.address, token.runtime]).toEqual([
    "31337",
    "0xffffffffffffffffffffffffffffffffffffffff",
    "0xe8ccd7c4eb891208d5e04a27a31dfaf2b9bce01e083d7b36f10b6dd6ea643e63",
  ]);
  expect(supportedQuotes(LOCAL_QUOTES, true)).toEqual(LOCAL_QUOTES);
  // hosted: no ERC-20 quote is ever supported
  expect(supportedQuotes(LOCAL_QUOTES, false)).toEqual([]);
  for (const key of Object.keys(token) as (keyof typeof token)[])
    expect(supportedQuotes([{ ...token, [key]: "unreviewed" }], true)).toEqual(
      [],
    );
  const erc20 = {
    ...pin,
    quote: token.address,
    quoteKind: "erc20" as const,
  };
  expect(supportedLaunch(erc20, LOCAL_INSTANCES, LOCAL_QUOTES)).toBe(true);
  expect(supportedLaunch(erc20, LOCAL_INSTANCES, [])).toBe(false);
  expect(
    supportedLaunch(
      { ...erc20, quote: `0x${"e".repeat(40)}` },
      LOCAL_INSTANCES,
      LOCAL_QUOTES,
    ),
  ).toBe(false);
  expect(
    supportedLaunch(
      { ...erc20, chainId: "1" },
      [{ ...pin, chainId: "1" }],
      LOCAL_QUOTES,
    ),
  ).toBe(false);
  // relabelling either kind is refused
  expect(
    supportedLaunch(
      { ...erc20, quoteKind: "native" },
      LOCAL_INSTANCES,
      LOCAL_QUOTES,
    ),
  ).toBe(false);
  expect(
    supportedLaunch(
      { ...pin, quote: NATIVE, quoteKind: "erc20" },
      LOCAL_INSTANCES,
      [{ ...token, address: NATIVE }],
    ),
  ).toBe(false);
});

test("supply: 0 < installed <= requested and sink = requested - installed, else refused", () => {
  const requested = 10n ** 27n;
  expect(
    launchSupply({
      requested,
      installed: 999999999999999999999999422n,
      sink: 578n,
    }),
  ).toEqual({
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999422",
    sink: "578",
    sink_holder: NATIVE,
  });
  expect(launchSupply({ requested, installed: requested, sink: 0n }).sink).toBe(
    "0",
  );
  const max = (1n << 127n) - 1n;
  expect(
    launchSupply({ requested: max, installed: 1n, sink: max - 1n }),
  ).toEqual({
    requested: max.toString(),
    installed: "1",
    sink: (max - 1n).toString(),
    sink_holder: NATIVE,
  });
  for (const bad of [
    { requested, installed: 0n, sink: requested },
    { requested, installed: -1n, sink: requested + 1n },
    { requested, installed: requested + 1n, sink: -1n },
    { requested, installed: requested - 578n, sink: 577n },
    { requested, installed: requested - 578n, sink: 579n },
    { requested: max + 1n, installed: 1n, sink: max },
    { requested: 0n, installed: 0n, sink: 0n },
  ])
    expect(() => launchSupply(bad)).toThrow(/Invalid indexed launch supply/);
});

const input = {
  model: "fixed_base_duration_v1" as const,
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
    if (result.model !== "fixed_base_duration_v1") throw new Error("model");
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
// durations 600/3600 s, [initial, final, duration, elapsed, fee]. These are
// study rates, not limits: every uint64 rate is valid and max is 2^64 - 1.
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

const MAX = (1n << 64n) - 1n;
test("the whole uint64 fee range is served exactly; 2^64 - 1 is the maximum, not a cap below it", () => {
  // l5 of the local fixture: max -> 0.3% over 3600 s, trading from 1800001400
  const l5 = {
    model: "fixed_base_duration_v1" as const,
    start: 1800001400n,
    duration: 3600n,
    initial: MAX,
    final: 55340232221128654n,
  };
  const at = (indexedTime: bigint) => feeSchedule({ ...l5, indexedTime });
  expect(at(1800001399n)).toMatchObject({
    phase: "before_trading_start",
    initial_fee: "18446744073709551615",
    fee_rate: "18446744073709551615",
  });
  expect(at(1800001400n).fee_rate).toBe("18446744073709551615");
  // the rate the contract applied to the fixture swap 1400 s in
  expect(at(1800002800n)).toMatchObject({
    phase: "fee_decay",
    fee_rate: "3470655575073783216",
  });
  expect(at(1800005000n)).toMatchObject({
    phase: "final_fee",
    fee_rate: "55340232221128654",
  });
  // l6: flat at the maximum
  expect(
    feeSchedule({
      model: "fixed_base_duration_v1",
      start: 1800001400n,
      duration: 1n,
      initial: MAX,
      final: MAX,
      indexedTime: 2115361000n,
    }),
  ).toMatchObject({
    initial_fee: MAX.toString(),
    final_fee: MAX.toString(),
    phase: "final_fee",
    fee_rate: MAX.toString(),
  });
  // rates above floor(2^64 * 99 / 100) are ordinary rates; zero is valid too
  for (const [initial, final] of [
    [MAX, 0n],
    [18262276632972456100n, 18262276632972456099n],
    [0n, 0n],
  ])
    expect(
      feeSchedule({ ...l5, initial, final, indexedTime: 1800001400n })
        .initial_fee,
    ).toBe(initial.toString());
});

test("fee fields are canonical decimal uint64 strings; 2^64 and malformed encodings are never served", () => {
  const schedule = FeeSchedule;
  const ok = feeSchedule({ ...input, indexedTime: 1000n });
  expect(schedule.safeParse(ok).success).toBe(true);
  for (const field of ["initial_fee", "final_fee", "fee_rate"] as const) {
    expect(schedule.safeParse({ ...ok, [field]: MAX.toString() }).success).toBe(
      true,
    );
    for (const bad of [
      "18446744073709551616",
      "36893488147419103231",
      "100000000000000000000",
      "018446744073709551615",
      "01",
      "-1",
      "+1",
      " 1",
      "1 ",
      "0x1",
      "1e18",
      "1.0",
      "",
      Number(MAX),
      1,
    ])
      expect(schedule.safeParse({ ...ok, [field]: bad }).success).toBe(false);
  }
  const swap = SwapPage.shape.data.element;
  const row = {
    event: {
      block_number: "1",
      block_hash: `0x${"a".repeat(64)}`,
      block_time: 1000,
      event_id: "1",
      transaction_index: 0,
      event_index: 0,
      transaction_hash: `0x${"b".repeat(64)}`,
    },
    forwarding_locker: `0x${"c".repeat(40)}`,
    direction: "buy",
    launch_token_delta: "-54160",
    quote_token_delta: "1000000000000000000",
    fee_rate: MAX.toString(),
    fee_amount: "999083373736809197195735",
    fee_asset: "launch_token",
  };
  expect(swap.safeParse(row).success).toBe(true);
  for (const fee_rate of ["18446744073709551616", "01", "1e3", Number(MAX)])
    expect(swap.safeParse({ ...row, fee_rate }).success).toBe(false);
  // fee amounts are token units, not rates: they may exceed 2^64
  expect(
    swap.safeParse({ ...row, fee_amount: (1n << 100n).toString() }).success,
  ).toBe(true);
});

test("invalid indexed domains fail, never coerce or overflow", () => {
  for (const change of [
    { start: -1n },
    { duration: 0n },
    { duration: 1n << 32n },
    { final: input.initial + 1n },
    { initial: 1n << 64n },
    { initial: 1n << 64n, final: 1n << 64n },
    { initial: 1n << 64n, final: MAX },
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
    schema_version: "zero-seed-launch-api/v5",
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
      schema_version: "zero-seed-launch-api/v4",
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
  for (const option of FeeSchedule.options)
    expect(Object.keys(option.shape)).not.toContain("decay_factor");
  // the tick-rate schedule has a floor, never an end
  const [, tickRate] = FeeSchedule.options;
  for (const field of ["fee_end", "fee_duration", "ends_at", "end"])
    expect(Object.keys(tickRate.shape)).not.toContain(field);
});

test("v4 supply is on every summary and replaces principal.installed_supply", () => {
  expect(Object.keys(LaunchSummary.shape)).toContain("supply");
  expect(Object.keys(LaunchSummary.shape.supply.shape)).toEqual([
    "requested",
    "installed",
    "sink",
    "sink_holder",
  ]);
  expect(Object.keys(LaunchDetail.shape.principal.shape)).not.toContain(
    "installed_supply",
  );
  expect(Object.keys(LaunchDetail.shape.principal.shape)).toContain(
    "liquidity",
  );
  const supply = LaunchSummary.shape.supply;
  const ok = {
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999210",
    sink: "790",
    sink_holder: NATIVE,
  };
  expect(supply.safeParse(ok).success).toBe(true);
  for (const bad of [
    { ...ok, sink: 790 },
    { ...ok, requested: "1e27" },
    { ...ok, installed: "-1" },
    { ...ok, sink_holder: `0x${"1".repeat(40)}` },
    { ...ok, burned: "790" },
  ])
    expect(supply.safeParse(bad).success).toBe(false);
});

// ---- tick_rate_v2 (evm-contracts 3d6378f) against the contract's frozen v7 vectors ----

const V2 = JSON.parse(
  readFileSync(
    resolve(import.meta.dir, "vectors/zero-seed-launch-v2-vectors.json"),
    "utf8",
  ),
);
// Elapsed seconds beyond 2^64 cannot be indexed; every positive rate has
// saturated long before.
const elapsedOf = (t: string) => {
  const value = BigInt(t);
  return value > 1n << 63n ? 1n << 63n : value;
};

test("tick-rate fee: every frozen fee row, table, tick step and saturation second", () => {
  expect(V2.version).toBe(7);
  const fx = V2.fixture;
  for (const row of V2.fee)
    expect(
      tickRateDecayedFee(
        BigInt(fx.fee_initial_q64),
        BigInt(fx.fee_final_q64),
        BigInt(row.decayRateX32),
        elapsedOf(row.t_minus_start),
      ).toString(),
    ).toBe(row.fee_q64);
  const curve = V2.fee_curve;
  const r = curve.rates_q64;
  const d = curve.decay_rates_x32;
  const f03 = BigInt(curve.final_fee_q64);
  const tables: [string, bigint, bigint, bigint][] = [
    [
      "default_one_day_50_to_0.3",
      BigInt(r["50"]),
      f03,
      BigInt(d.default_one_day),
    ],
    [
      "two_ticks_per_second_50_to_0.3",
      BigInt(r["50"]),
      f03,
      BigInt(d.two_ticks_per_second),
    ],
    [
      "two_ticks_per_second_99.9_to_0",
      BigInt(r["99.9"]),
      0n,
      BigInt(d.two_ticks_per_second),
    ],
    ["default_one_day_max_to_0", MAX, 0n, BigInt(d.default_one_day)],
    ["min_rate_max_to_0", MAX, 0n, 1n],
  ];
  for (const [name, initial, final, rate] of tables)
    for (const row of curve.tables[name])
      expect(
        tickRateDecayedFee(initial, final, rate, elapsedOf(row.t)).toString(),
      ).toBe(row.fee_q64);
  for (const steps of curve.tick_steps) {
    const initial =
      BigInt(steps.rows[0].fee_q64) === f03 + 1n ? f03 + 1n : BigInt(r["50"]);
    for (const row of steps.rows)
      expect(
        tickRateDecayedFee(
          initial,
          f03,
          BigInt(steps.decayRateX32),
          BigInt(row.t),
        ).toString(),
      ).toBe(row.fee_q64);
  }
  for (const [name, second] of Object.entries(curve.saturation_second)) {
    const rate = BigInt(d[name]);
    expect((MAX_DECAY_PRODUCT / rate).toString()).toBe(second as string);
    expect(
      tickRateDecayedFee(MAX, 0n, rate, BigInt(second as string) + 1n),
    ).toBe(0n);
  }
  expect(tickFactorQ128(0n)).toBe(1n << 128n);
  expect(tickFactorQ128(88722835n)).toBe(18447191164202170524n);
  expect(() => tickFactorQ128(88722836n)).toThrow();
});

test("tick-rate fee: the five SHA-256 chains the contract tests pin", async () => {
  for (const chain of V2.fee_curve.digests_sha256) {
    let h = new Uint8Array(32);
    for (let t = 0n; t <= BigInt(chain.last); t += BigInt(chain.step)) {
      const fee = tickRateDecayedFee(
        BigInt(chain.initialFee),
        BigInt(chain.finalFee),
        BigInt(chain.decayRateX32),
        t,
      );
      const word = new Uint8Array(40);
      word.set(h, 0);
      new DataView(word.buffer).setBigUint64(32, fee);
      h = new Uint8Array(await crypto.subtle.digest("SHA-256", word));
    }
    expect(Buffer.from(h).toString("hex")).toBe(chain.digest);
  }
}, 120_000);

test("tick-rate schedule: decimal-string rate, exact half-life, saturation, phases, no end", () => {
  const consumer = V2.creator_fee_range.reference_schedules.consumer_default;
  expect(decayRateForHalfLife(86400n).toString()).toBe(consumer.decayRateX32);
  expect(decayRateForHalfLife(600n)).toBe(9923486534471n);
  expect(HALF_LIFE_X32_E30.toString()).toBe(
    "5954091920683119788732747343471285361579197626",
  );
  for (const [rate, text] of [
    [68913100933n, "86400.000001"],
    [9923486534471n, "600.000000"],
    [8589934592n, "693147.527133"],
    [1073741824n, "5545180.217067"],
    [1n, "5954091920683119.788732"],
    [MAX, "0.000322"],
  ] as const)
    expect(halfLifeSeconds(rate)).toBe(text);
  expect(halfLifeSeconds(0n)).toBeNull();
  const base = {
    model: "tick_rate_v2" as const,
    start: 1000n,
    rate: BigInt(consumer.decayRateX32),
    initial: BigInt(consumer.initialFee),
    final: BigInt(consumer.finalFee),
  };
  const at = (indexedTime: bigint, change = {}) =>
    feeSchedule({ ...base, ...change, indexedTime });
  expect(at(999n)).toEqual({
    model: "tick_rate_v2",
    trading_start: 1000,
    initial_fee: consumer.initialFee,
    final_fee: consumer.finalFee,
    decay_rate_x32: "68913100933",
    half_life_seconds: "86400.000001",
    saturation_elapsed_seconds: "5529597",
    phase: "before_trading_start",
    fee_rate: consumer.initialFee,
    evaluated_at: 999,
  });
  expect(at(1000n + 86400n)).toMatchObject({
    phase: "decaying",
    fee_rate: consumer.fee_after_one_day_q64,
  });
  expect(at(1000n + 5529598n)).toMatchObject({
    phase: "at_floor",
    fee_rate: consumer.finalFee,
  });
  expect(at(5000n, { rate: 0n })).toMatchObject({
    phase: "constant",
    fee_rate: consumer.initialFee,
    half_life_seconds: null,
    saturation_elapsed_seconds: null,
  });
  expect(at(1001n, { rate: MAX })).toMatchObject({
    phase: "at_floor",
    saturation_elapsed_seconds: "0",
  });
  expect(at(5000n, { initial: 7n, final: 7n })).toMatchObject({
    phase: "at_floor",
  });
  for (const schedule of [
    at(999n),
    at(5000n, { rate: 0n }),
    at(2000n, { rate: MAX }),
  ]) {
    expect(FeeSchedule.safeParse(schedule).success).toBe(true);
    expect(schedule).not.toHaveProperty("fee_end");
  }
  // The rate is a canonical decimal uint64 string, never a number or 2^64.
  const ok = at(2000n);
  for (const bad of [
    "18446744073709551616",
    "01",
    "-1",
    "1e3",
    "",
    68913100933,
  ])
    expect(FeeSchedule.safeParse({ ...ok, decay_rate_x32: bad }).success).toBe(
      false,
    );
  for (const bad of ["86400", "86400.00000", "-1.000000", 86400])
    expect(
      FeeSchedule.safeParse({ ...ok, half_life_seconds: bad }).success,
    ).toBe(false);
  // A v2 row cannot carry v1 fields, nor v1 a v2 rate.
  expect(FeeSchedule.safeParse({ ...ok, fee_duration: 3600 }).success).toBe(
    false,
  );
  expect(
    FeeSchedule.safeParse({
      ...feeSchedule({ ...input, indexedTime: 1000n }),
      decay_rate_x32: "1",
    }).success,
  ).toBe(false);
  // Out-of-domain indexed values fail as 500, never coerce.
  for (const change of [
    { rate: 1n << 64n },
    { rate: -1n },
    { final: base.initial + 1n },
  ])
    expect(() => at(2000n, change)).toThrow();
  expect(() =>
    feeSchedule({ ...input, model: "other" as never, indexedTime: 1000n }),
  ).toThrow(/fee model/);
});
