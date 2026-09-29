import { ContractCase, QueryResult, stubQuery } from "../harness";
import { CORE, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

const POOL_ID =
  "0x614e2ba87050c938ccff35e3260b7ea9c6f5303365b8ee172ebd07e916015046";
const STABLESWAP_EXTENSION = BigInt(
  "0x553a2efc570c9e104942cec6ac1c18118e54c091",
).toString();

type PoolKeyRow = QueryResult<"getPoolKeyByCoreAndId">[number];
type ListedPoolKeyRow = QueryResult<"listPoolKeys">[number];

const concentratedPool: Omit<PoolKeyRow, "pool_key_id"> = {
  token0: "0",
  token1: USDC_DECIMAL,
  fee: "9223372036854775",
  tick_spacing: 1000,
  extension: "0",
  stableswap_center_tick: null,
  stableswap_amplification: null,
  // Packed extension | fee | tick spacing.
  pool_config: "39614081257132165326439400",
  state_sqrt_ratio: "17681590452805816215298018342076416",
  state_tick: -19_730_000,
  state_liquidity: "1572500836553",
};

// A stableswap pool has no tick spacing and carries its center tick and
// amplification instead. Declared as string | null in queries.ts; the
// columns are INT4 and INT2, which the driver returns as numbers.
const stableswapPool: Omit<PoolKeyRow, "pool_key_id"> = {
  ...concentratedPool,
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  tick_spacing: null,
  extension: STABLESWAP_EXTENSION,
  stableswap_center_tick: -19_730_000 as unknown as string,
  stableswap_amplification: 10 as unknown as string,
  pool_config:
    "38549393542740661678021248373509897400086468500495821779220149926589286240480",
};

// A legacy v2-core pool (no packed config) that was registered but never
// initialised, so there is no pool_states row to join.
const uninitialisedPool: Omit<ListedPoolKeyRow, "pool_id"> = {
  ...concentratedPool,
  token1: WETH_DECIMAL,
  pool_config: null,
  state_sqrt_ratio: null,
  state_tick: null,
  state_liquidity: null,
};

export const stateCases: ContractCase[] = [
  {
    operation: "/pools/{chainId}/{coreAddress}/{poolId}/liquidity",
    // per_pool_per_tick_liquidity.tick is INT4, so the driver returns a
    // number (declared as string in queries.ts) and the handler passes it
    // through, while the schema documents tick as a string.
    name: "/pools/{chainId}/{coreAddress}/{poolId}/liquidity tick is a number",
    knownDrift:
      "tick is an INT4 and is returned as a number; the schema says string.",
    request: `/pools/1/${CORE}/${POOL_ID}/liquidity`,
    stub: () =>
      stubQuery("getPoolLiquidityGraph", [
        {
          tick: -19_855_210 as unknown as string,
          net_liquidity_delta_diff: "125807721254",
        },
        {
          tick: -19_695_530 as unknown as string,
          net_liquidity_delta_diff: "-125807721254",
        },
      ]),
  },
  {
    operation: "/pools/{chainId}/{coreAddress}/{poolId}/key",
    request: `/pools/1/${CORE}/${POOL_ID}/key`,
    stub: () =>
      stubQuery("getPoolKeyByCoreAndId", [
        { pool_key_id: 43n, ...stableswapPool },
      ]),
  },
  {
    operation: "/poolKeys/{chainId}/{coreAddress}/{poolId}",
    request: `/poolKeys/1/${CORE}/${POOL_ID}`,
    stub: () =>
      stubQuery("getPoolKeyByCoreAndId", [
        { pool_key_id: 42n, ...concentratedPool },
      ]),
  },
  {
    operation: "/poolKeys/{chainId}/{coreAddress}",
    request: `/poolKeys/1/${CORE}?tokenA=0x0&limit=2`,
    stub: () =>
      stubQuery("listPoolKeys", [
        { pool_id: "1", ...concentratedPool },
        { pool_id: "2", ...uninitialisedPool },
        { pool_id: "3", ...stableswapPool },
      ]),
  },
];
