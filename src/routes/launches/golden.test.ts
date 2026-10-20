import { expect, test } from "bun:test";
import golden from "./fixtures/zero-seed-launch-api-v3.golden.json";
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
// example of every v3 response for integrators.
test("the emitted-state golden responses parse with the v3 schemas", () => {
  expect(golden.schema_version).toBe(SCHEMA_VERSION);
  for (const list of [golden.list, golden.second, golden.canonicalList])
    LaunchList.parse(list);
  for (const detail of [golden.nativeDetail, golden.erc20Detail])
    LaunchDetail.parse(detail);
  SwapPage.parse(golden.nativeSwaps);
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
