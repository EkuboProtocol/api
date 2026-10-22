import { expect, test } from "bun:test";
import golden from "./fixtures/zero-seed-launch-api-v4.golden.json";
import {
  ClaimPage,
  LaunchDetail,
  LaunchList,
  OwnerPage,
  SCHEMA_VERSION,
  SwapPage,
} from "./schema";

// Written by scripts/verifyLaunchReplay.ts (LAUNCH_GOLDEN_DIR) from the actual
// handlers over the indexer's replayed local fixture; a machine-readable
// example of every v4 response for integrators.
test("the emitted-state golden responses parse with the v4 schemas", () => {
  expect(golden.schema_version).toBe(SCHEMA_VERSION);
  for (const list of [golden.list, golden.second, golden.canonicalList])
    LaunchList.parse(list);
  for (const detail of [
    golden.nativeDetail,
    golden.erc20Detail,
    golden.erc20TraderOwnedDetail,
    golden.maxNativeDetail,
    golden.maxErc20Detail,
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
