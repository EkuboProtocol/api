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
  launchSupply,
  LOCAL_INSTANCES,
  LOCAL_QUOTES,
  supportedInstances,
  supportedLaunch,
  supportedQuotes,
} from "./policy";
import {
  ClaimPage,
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
  expect(LOCAL_INSTANCES).toHaveLength(1);
  for (const pin of LOCAL_INSTANCES) {
    expect(Object.keys(pin).some((key) => /quote/i.test(key))).toBe(false);
    for (const key of Object.keys(pin) as (keyof typeof pin)[]) {
      expect(
        supportedInstances([{ ...pin, [key]: "unreviewed" }], true),
      ).toEqual([]);
    }
    const native = { ...pin, quote: NATIVE, quoteKind: "native" as const };
    expect(supportedLaunch(native, LOCAL_INSTANCES, [])).toBe(true);
    for (const key of ["chainId", "address", "periphery", "core"] as const) {
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
  const schedule = LaunchDetail.shape.fee_schedule;
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
    schema_version: "zero-seed-launch-api/v4",
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
      schema_version: "zero-seed-launch-api/v3",
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
