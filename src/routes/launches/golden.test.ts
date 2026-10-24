import { expect, test } from "bun:test";
import golden from "./fixtures/zero-seed-launch-api-v5.golden.json";
import tickRate from "./fixtures/zero-seed-launch-api-v5-tick-rate.golden.json";
import { halfLifeSeconds, MAX_DECAY_PRODUCT } from "./policy";
import {
  ClaimPage,
  LaunchDetail,
  LaunchList,
  OwnerPage,
  SCHEMA_VERSION,
  SwapPage,
} from "./schema";

// Written by scripts/verifyLaunchReplay.ts (LAUNCH_GOLDEN_DIR) from the actual
// handlers over the indexer's replayed local fixtures; a machine-readable
// example of every v5 response for integrators, per fee model.
test("the emitted-state golden responses parse with the v5 schemas", () => {
  expect(golden.schema_version).toBe(SCHEMA_VERSION);
  for (const list of [golden.list, golden.second, golden.canonicalList])
    LaunchList.parse(list);
  for (const detail of [
    golden.nativeDetail,
    golden.erc20Detail,
    golden.erc20TraderOwnedDetail,
    golden.maxNativeDetail,
    golden.maxErc20Detail,
    golden.lowPriceErc20Detail,
    golden.fullWidthErc20Detail,
  ])
    LaunchDetail.parse(detail);
  for (const swaps of [
    golden.nativeSwaps,
    golden.erc20Swaps,
    golden.maxNativeSwaps,
    golden.maxErc20Swaps,
  ])
    SwapPage.parse(swaps);
  for (const claims of [
    golden.nativeClaims,
    golden.erc20Claims,
    golden.maxNativeClaims,
    golden.maxErc20Claims,
  ])
    ClaimPage.parse(claims);
  for (const owners of [golden.nativeOwners, golden.erc20Owners])
    OwnerPage.parse(owners);
  expect(golden.nativeDetail.quote_token).toEqual({
    address: "0x0000000000000000000000000000000000000000",
    name: null,
    symbol: null,
    decimals: 18,
    kind: "native",
  });
  expect(golden.erc20Detail.quote_token.kind).toBe("erc20");
});

test("native token1 and ERC-20 token0 launches share one extension and split requested/installed/sink exactly", () => {
  const sink = "0x0000000000000000000000000000000000000000";
  const native = golden.nativeDetail;
  const erc20 = golden.erc20Detail;
  expect(native.pool_key.extension).toBe(erc20.pool_key.extension);
  expect([native.launch_token_is_token1, erc20.launch_token_is_token1]).toEqual(
    [true, false],
  );
  expect(native.supply).toEqual({
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999422",
    sink: "578",
    sink_holder: sink,
  });
  expect(erc20.supply).toEqual({
    requested: "1000000000000000000000000000",
    installed: "999999999999999999999999210",
    sink: "790",
    sink_holder: sink,
  });
  for (const launch of [
    ...golden.canonicalList.data,
    native,
    erc20,
    golden.erc20TraderOwnedDetail,
  ]) {
    const { requested, installed, sink } = launch.supply;
    expect(BigInt(requested) - BigInt(installed)).toBe(BigInt(sink));
    expect(launch).not.toHaveProperty("principal.installed_supply");
  }
  // creator stays; owner follows transfers
  for (const [detail, owners] of [
    [native, golden.nativeOwners],
    [erc20, golden.erc20Owners],
  ] as const) {
    expect(detail.creator).not.toBe(detail.owner);
    expect(owners.data[0].new_owner).toBe(detail.creator);
    expect(owners.data.at(-1)!.new_owner).toBe(detail.owner);
  }
});

const MAX = "18446744073709551615";
const FINAL = "55340232221128654";

test("launches created at the maximum rate 2^64 - 1 are served exactly, never as 2^64", () => {
  const l5 = golden.maxNativeDetail;
  const l6 = golden.maxErc20Detail;
  // l5: native quote, max -> 0.3% over 3600 s; l6: ERC-20 quote, flat max
  expect([l5.quote_token.kind, l5.launch_token_is_token1]).toEqual([
    "native",
    true,
  ]);
  expect([l6.quote_token.kind, l6.launch_token_is_token1]).toEqual([
    "erc20",
    false,
  ]);
  expect(l5.fee_schedule).toMatchObject({
    model: "fixed_base_duration_v1",
    initial_fee: MAX,
    final_fee: FINAL,
    fee_duration: 3600,
    phase: "final_fee",
    fee_rate: FINAL,
  });
  expect(l6.fee_schedule).toMatchObject({
    initial_fee: MAX,
    final_fee: MAX,
    fee_duration: 1,
    phase: "final_fee",
    fee_rate: MAX,
  });
  expect(
    golden.canonicalList.data
      .filter((l) => l.fee_schedule.initial_fee === MAX)
      .map((l) => l.pool_id),
  ).toEqual([l6.pool_id, l5.pool_id]);
  // l5 decays from the maximum; its swaps carry the contract's feeAt
  expect(golden.maxNativeSwaps.data.map((s) => s.fee_rate)).toEqual([
    MAX,
    MAX,
    "3470655575073783216",
    FINAL,
    FINAL,
  ]);
  expect(golden.maxErc20Swaps.data.map((s) => s.fee_rate)).toEqual([MAX, MAX]);
  for (const [detail, swaps, claims] of [
    [l5, golden.maxNativeSwaps, golden.maxNativeClaims],
    [l6, golden.maxErc20Swaps, golden.maxErc20Claims],
  ] as const) {
    // exact input at the maximum nets floor(gross / 2^64); exact output
    // pays calculated * 2^64
    const [exactIn, exactOut] = swaps.data;
    const net = -BigInt(exactIn.launch_token_delta);
    expect(net).toBe(54160n);
    expect((net + BigInt(exactIn.fee_amount)) / 2n ** 64n).toBe(net);
    expect(BigInt(exactOut.quote_token_delta)).toBe(10019n * 2n ** 64n);
    expect(
      BigInt(exactOut.quote_token_delta) - BigInt(exactOut.fee_amount),
    ).toBe(10019n);
    // every fee accrues once to its asset's creator ledger and is claimed
    for (const asset of ["launch_token", "quote_token"] as const) {
      const accrued = swaps.data
        .filter((s) => s.fee_asset === asset)
        .reduce((n, s) => n + BigInt(s.fee_amount), 0n);
      expect(detail.fee_ledger[asset].accrued).toBe(accrued.toString());
      expect(detail.fee_ledger[asset].unclaimed).toBe("0");
      expect(
        claims.data.reduce((n, c) => n + BigInt(c[`${asset}_amount`]), 0n),
      ).toBe(accrued);
    }
  }
});

test("low-price ERC-20 token0 launches serve the exact installation, including an empty sink", () => {
  const sinkHolder = "0x0000000000000000000000000000000000000000";
  const l7 = golden.lowPriceErc20Detail;
  const l8 = golden.fullWidthErc20Detail;
  // 1e30 over ticks -88080384..-85983232 at spacing 524288: the largest
  // affordable liquidity, 115073586432 (the shared helper gave 106052588672)
  expect([
    l7.supply,
    l7.principal.liquidity,
    l7.launch_token_is_token1,
  ]).toEqual([
    {
      requested: "1000000000000000000000000000000",
      installed: "999999999991410763432286846442",
      sink: "8589236567713153558",
      sink_holder: sinkHolder,
    },
    "115073586432",
    false,
  ]);
  // an int128-scale supply over the full width at spacing 1 installs exactly
  expect([
    l8.supply,
    l8.principal.liquidity,
    l8.launch_token_is_token1,
  ]).toEqual([
    {
      requested: "170141183460469231694794709727778658247",
      installed: "170141183460469231694794709727778658247",
      sink: "0",
      sink_holder: sinkHolder,
    },
    "9223595582101085260",
    false,
  ]);
  for (const detail of [l7, l8])
    expect(BigInt(detail.supply.installed) + BigInt(detail.supply.sink)).toBe(
      BigInt(detail.supply.requested),
    );
});

test("tick-rate golden: every response parses, rates are decimal strings and schedules have a floor, not an end", () => {
  expect(tickRate.schema_version).toBe(SCHEMA_VERSION);
  expect(tickRate.source.fee_model).toBe("tick_rate_v2");
  LaunchList.parse(tickRate.list);
  const launches = [
    tickRate.l1,
    tickRate.l2,
    tickRate.l4,
    tickRate.l5,
    tickRate.l6,
  ];
  for (const { detail, swaps, claims } of launches) {
    LaunchDetail.parse(detail);
    SwapPage.parse(swaps);
    ClaimPage.parse(claims);
  }
  for (const launch of [
    ...tickRate.list.data,
    ...launches.map((l) => l.detail),
  ]) {
    const schedule = launch.fee_schedule;
    expect(schedule.model).toBe("tick_rate_v2");
    expect(schedule).not.toHaveProperty("fee_end");
    expect(schedule).not.toHaveProperty("fee_duration");
    if (schedule.model !== "tick_rate_v2") throw new Error("model");
    const rate = BigInt(schedule.decay_rate_x32);
    expect(schedule.half_life_seconds).toBe(halfLifeSeconds(rate));
    expect(schedule.saturation_elapsed_seconds).toBe(
      rate === 0n ? null : (MAX_DECAY_PRODUCT / rate).toString(),
    );
  }
  expect(
    tickRate.list.data.map((l) => l.fee_schedule.decay_rate_x32).sort(),
  ).toEqual(
    [
      "0",
      "1",
      "68913100933",
      "68913100933",
      "68913100933",
      "9923486534471",
      MAX,
    ].sort(),
  );
  // rate 0 is flat at the initial fee; every other launch is at its floor by the head
  expect(tickRate.l4.detail.fee_schedule).toMatchObject({
    decay_rate_x32: "0",
    phase: "constant",
    half_life_seconds: null,
  });
  expect(tickRate.l1.detail.fee_schedule).toMatchObject({
    decay_rate_x32: "9923486534471",
    half_life_seconds: "600.000000",
    phase: "at_floor",
  });
});
