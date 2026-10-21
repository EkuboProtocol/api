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
  ])
    LaunchDetail.parse(detail);
  for (const swaps of [golden.nativeSwaps, golden.erc20Swaps])
    SwapPage.parse(swaps);
  for (const claims of [golden.nativeClaims, golden.erc20Claims])
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
    expect(owners.data[0]!.new_owner).toBe(detail.creator);
    expect(owners.data.at(-1)!.new_owner).toBe(detail.owner);
  }
});
