import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  alignedRange,
  decayRateForHalfLife,
  feeAt,
  feeSchedule,
  halfLifeSeconds,
  HALF_LIFE_X32_E30,
  launchStatus,
  launchSupply,
  LOCAL_INSTANCES,
  LOCAL_QUOTES,
  marketData,
  MAX_DECAY_PRODUCT,
  priceX128,
  share18,
  supportedInstances,
  supportedQuote,
  supportedQuotes,
  tickFactorQ128,
  unpackString,
  utf8OrNull,
} from "./policy";
import { FeeSchedule, LaunchDetail, LaunchList, LaunchSummary } from "./schema";

const NATIVE = "0x0000000000000000000000000000000000000000";
const MAX = (1n << 64n) - 1n;
const vectors = resolve(import.meta.dir, "vectors");
const read = (name: string) => readFileSync(resolve(vectors, name));
const V = JSON.parse(read("zero-seed-launch.json").toString("utf8"));
const INSTALL = JSON.parse(
  read("zero-seed-launch-installation.json").toString("utf8"),
);

test("vendored vectors are the freeze's bytes", () => {
  const sha = (name: string) =>
    createHash("sha256").update(read(name)).digest("hex");
  expect(sha("zero-seed-launch.json")).toBe(
    "e5444bf6b1f7e422238331b50b64cf0400597bd13421e281615735511274190b",
  );
  expect(sha("zero-seed-launch-installation.json")).toBe(
    "5cf44854cbf00abb700936b2e22782c27dac5e68cf892edc8f5aa7090067a555",
  );
  expect(sha("zero-seed-launch-events.json")).toBe(
    "24dd5883ce242ec523517c9f38cfd5e8ca29740974aeded5740ac3608e1e7066",
  );
  expect(V.version).toBe(8);
});

test("local instance manifests bind every field, carry no quote and are refused when hosted", () => {
  expect(supportedInstances(LOCAL_INSTANCES, true)).toEqual(LOCAL_INSTANCES);
  expect(supportedInstances(LOCAL_INSTANCES, false)).toEqual([]);
  expect(supportedInstances([], true)).toEqual([]);
  for (const pin of LOCAL_INSTANCES) {
    expect(Object.keys(pin).some((key) => /quote|model/i.test(key))).toBe(
      false,
    );
    for (const key of Object.keys(pin) as (keyof typeof pin)[])
      expect(
        supportedInstances([{ ...pin, [key]: "unreviewed" }], true),
      ).toEqual([]);
  }
});

test("quote support is per launch: native, or a reviewed ERC-20 by chain/address/runtime", () => {
  const [token] = LOCAL_QUOTES;
  expect(supportedQuotes(LOCAL_QUOTES, true)).toEqual(LOCAL_QUOTES);
  expect(supportedQuotes(LOCAL_QUOTES, false)).toEqual([]);
  for (const key of Object.keys(token) as (keyof typeof token)[])
    expect(supportedQuotes([{ ...token, [key]: "unreviewed" }], true)).toEqual(
      [],
    );
  const row = { chainId: token.chainId, quote: token.address };
  expect(supportedQuote({ ...row, quoteKind: "erc20" }, LOCAL_QUOTES)).toBe(
    true,
  );
  expect(supportedQuote({ ...row, quoteKind: "erc20" }, [])).toBe(false);
  expect(
    supportedQuote({ ...row, chainId: "1", quoteKind: "erc20" }, LOCAL_QUOTES),
  ).toBe(false);
  expect(supportedQuote({ ...row, quoteKind: "native" }, LOCAL_QUOTES)).toBe(
    false,
  );
  expect(
    supportedQuote({ ...row, quote: NATIVE, quoteKind: "native" }, []),
  ).toBe(true);
  expect(
    supportedQuote({ ...row, quote: NATIVE, quoteKind: "erc20" }, [
      { ...token, address: NATIVE },
    ]),
  ).toBe(false);
});

test("supply: 0 < installed <= requested <= 10^30 and sink = requested - installed", () => {
  const [first] = INSTALL.vectors;
  const requested = BigInt(first.supply);
  expect(
    launchSupply({
      requested,
      installed: BigInt(first.installedSupply),
      sink: BigInt(first.sink),
    }),
  ).toEqual({
    requested: first.supply,
    installed: first.installedSupply,
    sink: first.sink,
    sink_holder: NATIVE,
  });
  for (const v of INSTALL.vectors)
    if (v.installedSupply !== undefined && v.sink !== undefined)
      expect(
        launchSupply({
          requested: BigInt(v.supply),
          installed: BigInt(v.installedSupply),
          sink: BigInt(v.sink),
        }).sink,
      ).toBe(v.sink);
  const cap = 10n ** 30n;
  expect(launchSupply({ requested: cap, installed: cap, sink: 0n }).sink).toBe(
    "0",
  );
  for (const bad of [
    { requested, installed: 0n, sink: requested },
    { requested, installed: requested + 1n, sink: -1n },
    { requested, installed: requested - 492n, sink: 491n },
    { requested: cap + 1n, installed: cap + 1n, sink: 0n },
  ])
    expect(() => launchSupply(bad)).toThrow(/Invalid indexed launch supply/);
});

test("spacing and signed alignment reproduce every frozen installation vector", () => {
  expect(INSTALL.vectors.length).toBe(64);
  // eight vectors are tick refusals and have no geometry
  const geometric = INSTALL.vectors.filter(
    (v: { tickSpacing?: number }) => v.tickSpacing !== undefined,
  );
  expect(geometric.length).toBe(56);
  for (const v of geometric) {
    const range = alignedRange(v.askTick, v.upperTick);
    expect(range).toEqual({
      tick_spacing: v.tickSpacing,
      aligned_ask_tick: v.alignedAskTick,
      aligned_upper_tick: v.alignedUpperTick,
    });
    const [lower, upper] =
      v.order === "t1"
        ? [-range.aligned_upper_tick, -range.aligned_ask_tick]
        : [range.aligned_ask_tick, range.aligned_upper_tick];
    expect([lower, upper]).toEqual([v.tickLower, v.tickUpper]);
  }
  // the spec's table, including no snapping to 1024
  expect(alignedRange(-13815500, -9210300)).toEqual({
    tick_spacing: 17990,
    aligned_ask_tick: -13798330,
    aligned_upper_tick: -9210880,
  });
  expect(alignedRange(-5000001, 4999999)).toEqual({
    tick_spacing: 39063,
    aligned_ask_tick: -4961001,
    aligned_upper_tick: 4961001,
  });
  expect(alignedRange(-88722835, 88722835).tick_spacing).toBe(693148);
  expect(() => alignedRange(5, 5)).toThrow();
});

test("names and symbols decode from canonical packOne words; non-canonical words are refused", () => {
  const { examples } = V.metadata;
  expect(unpackString(BigInt(examples["Zero Seed"]))).toBe("Zero Seed");
  expect(unpackString(BigInt(examples.ZERO))).toBe("ZERO");
  const pack = (bytes: number[]) =>
    BigInt(
      `0x${[bytes.length, ...bytes]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .padEnd(64, "0")}`,
    );
  // multi-byte UTF-8, a NUL byte and 31 bytes round-trip; invalid UTF-8 is null
  expect(unpackString(pack([...new TextEncoder().encode("Zéro 🚀")]))).toBe(
    "Zéro 🚀",
  );
  expect(unpackString(pack([0x41, 0x00, 0x42]))).toBe("A\u0000B");
  expect(unpackString(pack(Array(31).fill(0x61)))).toBe("a".repeat(31));
  expect(unpackString(pack([0xff, 0xfe]))).toBeNull();
  for (const bad of [
    0n,
    32n << 248n,
    pack([0x41]) | 1n,
    (1n << 248n) | (0x41n << 240n) | (0x42n << 232n),
  ])
    expect(() => unpackString(bad)).toThrow(/packed/);
});

test("logos: empty and invalid UTF-8 are null, everything else is served byte for byte", () => {
  const events = JSON.parse(
    read("zero-seed-launch-events.json").toString("utf8"),
  );
  const logos = events.LaunchCreated.map((e: { logo: string }) => e.logo);
  expect(logos).toEqual(["", "https://example.invalid/logo.svg"]);
  // The last field of LaunchCreated.data: after poolKey (3 words),
  // positionId, liquidity and the 11-word parameters, the offset of an ABI
  // string (length, then bytes).
  for (const created of events.LaunchCreated) {
    const data = Buffer.from(created.data.slice(2), "hex");
    const offset = Number(
      BigInt(`0x${data.subarray(16 * 32, 17 * 32).toString("hex")}`),
    );
    const size = Number(
      BigInt(`0x${data.subarray(offset, offset + 32).toString("hex")}`),
    );
    const bytes = data.subarray(offset + 32, offset + 32 + size);
    expect(utf8OrNull(bytes)).toBe(created.logo === "" ? null : created.logo);
  }
  expect(utf8OrNull(new Uint8Array([0x68, 0xc3]))).toBeNull();
  expect(utf8OrNull(new TextEncoder().encode("javascript:alert(1)"))).toBe(
    "javascript:alert(1)",
  );
});

// Elapsed seconds beyond 2^63 cannot be indexed; every positive rate has
// saturated long before.
const elapsedOf = (t: string) => {
  const value = BigInt(t);
  return value > 1n << 63n ? 1n << 63n : value;
};

test("fee: every frozen fee row, table, tick step and saturation second", () => {
  const fx = V.fixture;
  expect(V.fee.length).toBe(40);
  for (const row of V.fee)
    expect(
      feeAt(
        BigInt(fx.fee_initial_q64),
        BigInt(fx.fee_final_q64),
        BigInt(row.decayRateX32),
        elapsedOf(row.t_minus_start),
      ).toString(),
    ).toBe(row.fee_q64);
  const curve = V.fee_curve;
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
      expect(feeAt(initial, final, rate, elapsedOf(row.t)).toString()).toBe(
        row.fee_q64,
      );
  for (const steps of curve.tick_steps) {
    const initial =
      BigInt(steps.rows[0].fee_q64) === f03 + 1n ? f03 + 1n : BigInt(r["50"]);
    for (const row of steps.rows)
      expect(
        feeAt(
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
    expect(feeAt(MAX, 0n, rate, BigInt(second as string) + 1n)).toBe(0n);
  }
  expect(tickFactorQ128(0n)).toBe(1n << 128n);
  expect(tickFactorQ128(88722835n)).toBe(18447191164202170524n);
  expect(() => tickFactorQ128(88722836n)).toThrow();
});

test("fee: the five SHA-256 chains the contract tests pin", async () => {
  for (const chain of V.fee_curve.digests_sha256) {
    let h = new Uint8Array(32);
    for (let t = 0n; t <= BigInt(chain.last); t += BigInt(chain.step)) {
      const fee = feeAt(
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

test("schedule: decimal-string rate, exact half-life, saturation, phases, no end", () => {
  const consumer = V.creator_fee_range.reference_schedules.consumer_default;
  expect(decayRateForHalfLife(86400n).toString()).toBe(consumer.decayRateX32);
  expect(decayRateForHalfLife(600n)).toBe(9923486534471n);
  expect(HALF_LIFE_X32_E30.toString()).toBe(
    "5954091920683119788732747343471285361579197626",
  );
  for (const [rate, text] of [
    [68913100933n, "86400.000001"],
    [9923486534471n, "600.000000"],
    [1n, "5954091920683119.788732"],
    [MAX, "0.000322"],
  ] as const)
    expect(halfLifeSeconds(rate)).toBe(text);
  expect(halfLifeSeconds(0n)).toBeNull();
  const base = {
    start: 1000n,
    rate: BigInt(consumer.decayRateX32),
    initial: BigInt(consumer.initialFee),
    final: BigInt(consumer.finalFee),
  };
  const at = (time: bigint, change = {}) =>
    feeSchedule({ ...base, ...change, time });
  expect(at(999n)).toEqual({
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
  const ok = at(2000n);
  expect(FeeSchedule.safeParse(ok).success).toBe(true);
  for (const bad of ["18446744073709551616", "01", "-1", "1e3", "", 6891])
    expect(FeeSchedule.safeParse({ ...ok, decay_rate_x32: bad }).success).toBe(
      false,
    );
  for (const extra of [
    { model: "tick_rate_v2" },
    { fee_end: 1 },
    { fee_duration: 3600 },
  ])
    expect(FeeSchedule.safeParse({ ...ok, ...extra }).success).toBe(false);
  for (const change of [
    { rate: 1n << 64n },
    { rate: -1n },
    { initial: 1n << 64n, final: 0n },
    { final: base.initial + 1n },
  ])
    expect(() => at(2000n, change)).toThrow();
});

test("status is upcoming strictly before trading_start, trading from it on", () => {
  expect(launchStatus(1000n, 999n)).toBe("upcoming");
  expect(launchStatus(1000n, 1000n)).toBe("trading");
  expect(launchStatus(1000n, 1001n)).toBe("trading");
});

test("market data: exact price, market cap, raised and sold share", () => {
  const Q = 1n << 128n;
  // sqrt ratio 1.0: one raw quote per raw launch token in either order
  expect(priceX128(Q, false)).toBe(Q);
  expect(priceX128(Q, true)).toBe(Q);
  // token1 per token0 = 4: a token0 launch costs 4, a token1 launch 1/4
  expect(priceX128(2n * Q, false)).toBe(4n * Q);
  expect(priceX128(2n * Q, true)).toBe(Q / 4n);
  expect(() => priceX128(0n, false)).toThrow();
  expect(share18(1n, 3n)).toBe("0.333333333333333333");
  expect(share18(0n, 3n)).toBe("0.000000000000000000");
  expect(share18(3n, 3n)).toBe("1.000000000000000000");
  const market = marketData({
    sqrtRatio: 2n * Q,
    tick: 1386295,
    launchIsToken1: true,
    totalSupply: 1000n,
    installed: 900n,
    tokenReserve: 600n,
    quoteReserve: 77n,
    marketCapUsd: null,
    tradeCount: 3n,
    volume: 154n,
    volumeUsd: null,
  });
  expect(market).toEqual({
    price_tick: -1386295,
    price_x128: (Q / 4n).toString(),
    market_cap: "250",
    market_cap_usd: null,
    raised: "77",
    sold: "300",
    sold_share: "0.333333333333333333",
    trade_count: 3,
    volume: "154",
    volume_usd: null,
  });
  // dust above the installed amount never makes sold negative
  expect(
    marketData({
      ...{ sqrtRatio: Q, tick: 0, launchIsToken1: false, totalSupply: 10n },
      installed: 9n,
      tokenReserve: 10n,
      quoteReserve: 0n,
      marketCapUsd: "1.000000",
      tradeCount: 0n,
      volume: 0n,
      volumeUsd: "0.000000",
    }).sold,
  ).toBe("0");
});

test("v7 schemas are final-only and closed", () => {
  const keys = Object.keys(LaunchSummary.shape);
  for (const key of [
    "logo_url",
    "parameters",
    "range",
    "status",
    "market",
    "creator",
    "owner",
    "controller",
  ])
    expect(keys).toContain(key);
  for (const key of ["fee_model", "ask_tick", "upper_tick", "inventory"])
    expect(keys).not.toContain(key);
  expect(Object.keys(LaunchDetail.shape)).toContain("fee_ledger");
  expect(Object.keys(LaunchList.shape).sort()).toEqual(
    [
      "schema_version",
      "data",
      "total",
      "totals",
      "aggregates",
      "next_offset",
      "evaluated_at",
      "heads",
    ].sort(),
  );
});
