import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

// sha256 of `jq -cS .abi` (no trailing newline) of the evm-contracts 4f1a3060
// build, as in the protocol manifest.
export const ABI_SHA256 =
  "21f9e2c0166ab28ce8573c481de5b0fc2f37dd7595d496d326f0a2d1a544254e";
export const PERIPHERY_ABI_SHA256 =
  "5c563488b843aee923d0d819a66489eeee543dd20d1582de1f5df643f5d08a75";
const CORE = "0x00000000000014aa86c5d3c41765bb24e11bd701";
const WETH_RUNTIME =
  "0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c";

export interface LaunchInstance {
  chainId: string;
  address: string;
  runtime: string;
  periphery: string;
  peripheryRuntime: string;
  core: string;
  quote: string;
  quoteKind: "native" | "erc20";
  /** null for native ETH, which has no code. */
  quoteRuntime: string | null;
  abiSha256: string;
  peripheryAbiSha256: string;
}

// Constructor-executed LOCAL instances of the indexer replay fixture
// (evm-contracts 4f1a3060, anvil, no fork): native ETH and relocated plain
// WETH. No live instance exists. Never enable these via a hosted
// configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    address: "0x5114703a4cf4256f0acb68f992c861d8c4d1b173",
    runtime:
      "0x846786a63ba1a2c976f748fdc94b8cbc8f76dc64f07452333d36ff564f281bf7",
    periphery: "0xb27e16c3d01850191c1e027f7a3372cd2e1fb324",
    peripheryRuntime:
      "0x57d0ee27c634ac08d08b60bf8e6c2f185c7e9444613ccfde5ac9bbb5e3f84f2a",
    core: CORE,
    quote: "0x0000000000000000000000000000000000000000",
    quoteKind: "native",
    quoteRuntime: null,
    abiSha256: ABI_SHA256,
    peripheryAbiSha256: PERIPHERY_ABI_SHA256,
  },
  {
    chainId: "31337",
    address: "0x519435a42752da78e395999218d0ecc4fdcbcf4b",
    runtime:
      "0x56e32aeac03464c3babd754fc21e0594c42d82db9d9c0cc3dd1ce1ec20273750",
    periphery: "0x94e1b338def908449e6ea7c7d254630b45d27562",
    peripheryRuntime:
      "0xb78ea649f2e1817c851f7417a604d1565a346c6bec022abc821e3f1110739ac8",
    core: CORE,
    quote: "0xffffffffffffffffffffffffffffffffffffffff",
    quoteKind: "erc20",
    quoteRuntime: WETH_RUNTIME,
    abiSha256: ABI_SHA256,
    peripheryAbiSha256: PERIPHERY_ABI_SHA256,
  },
];

/** An explicit local harness manifest, never an address-only allowlist. */
export function supportedInstances(
  requested: readonly LaunchInstance[],
  localHarness: boolean,
): readonly LaunchInstance[] {
  if (!localHarness) return [];
  return requested.filter((request) =>
    LOCAL_INSTANCES.some((pin) =>
      (Object.keys(pin) as (keyof LaunchInstance)[]).every(
        (key) => pin[key] === request[key],
      ),
    ),
  );
}

export function supportedLaunch(
  row: Pick<
    LaunchInstance,
    "chainId" | "address" | "periphery" | "core" | "quote" | "quoteKind"
  >,
  enabled: readonly LaunchInstance[],
): boolean {
  return enabled.some(
    (pin) =>
      pin.chainId === row.chainId &&
      pin.address === row.address &&
      pin.periphery === row.periphery &&
      pin.core === row.core &&
      pin.quote === row.quote &&
      pin.quoteKind === row.quoteKind,
  );
}

const UINT64_MAX = (1n << 64n) - 1n;
function uint64(value: bigint) {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error("Invalid indexed uint64");
  }
  return value;
}

// JSON Unix seconds must be exactly representable; never round indexed time.
function seconds(value: bigint) {
  uint64(value);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Indexed time exceeds exact JSON integer domain");
  }
  return Number(value);
}

const Q128 = 1n << 128n;
/** Elapsed seconds from which the decay is exactly zero. */
export const DECAY_ZERO_FROM = 131072n;
/** round(2^128 * 2^(-2^i/600)) for bits i = 0..16 (math/feeDecay.sol). */
export const DECAY_TABLE_Q128: readonly bigint[] = [
  339889484297159900493648602831395569057n,
  339497055287118257930533248299650400736n,
  338713556013920184336129943844147573651n,
  337151977828609613753562640265082287810n,
  334050386396171404885545237344599070716n,
  327932539264834336949184815807600758235n,
  316030922441737935988095136387330274498n,
  293507844215098455952964317090465751204n,
  253162852354938356992240649094357060196n,
  188347784201757897225807540435664088841n,
  104251325552682051605813724741512712010n,
  31939177389160626453527783486618815759n,
  2997836947964109484105344435429137776n,
  26410496811510722015611852309540293n,
  2049810421099131403277778219901n,
  12347753427443481862030n,
  448060n,
];

/**
 * decayQ128 of the contract: 2^(-elapsed/600) in Q128. Starting at 2^128,
 * multiply by the constant of each set bit in ascending order and floor after
 * every multiply; exactly zero from 2^17 seconds. BigInt division floors for
 * these non-negative operands.
 */
export function decayQ128(elapsed: bigint): bigint {
  if (elapsed < 0n) throw new Error("Negative elapsed time");
  if (elapsed >= DECAY_ZERO_FROM) return 0n;
  let result = Q128;
  DECAY_TABLE_Q128.forEach((constant, bit) => {
    if ((elapsed >> BigInt(bit)) & 1n) result = (result * constant) / Q128;
  });
  return result;
}

/**
 * decayedFee of the contract: initial at zero elapsed, then
 * final + floor((initial - final) * (decay(t) - decay(D)) / (2^128 - decay(D))),
 * then final from the duration on.
 */
export function decayedFee(
  initial: bigint,
  final: bigint,
  duration: bigint,
  elapsed: bigint,
): bigint {
  if (elapsed === 0n) return initial;
  if (elapsed >= duration) return final;
  const endpoint = decayQ128(duration);
  return (
    final +
    ((initial - final) * (decayQ128(elapsed) - endpoint)) / (Q128 - endpoint)
  );
}

export function feeSchedule(input: {
  start: bigint;
  duration: bigint;
  initial: bigint;
  final: bigint;
  indexedTime: bigint;
}): z.infer<typeof FeeSchedule> {
  const { start, duration, initial, final, indexedTime } = input;
  [start, duration, initial, final, indexedTime].forEach(uint64);
  if (duration === 0n || duration > 0xffffffffn || final > initial) {
    throw new Error("Invalid indexed fee schedule");
  }
  const end = uint64(start + duration);
  const phase = feePhase(start, end, indexedTime);
  const elapsed = indexedTime > start ? indexedTime - start : 0n;
  const rate = decayedFee(initial, final, duration, elapsed);
  return {
    trading_start: seconds(start),
    fee_duration: seconds(duration),
    fee_end: seconds(end),
    initial_fee: initial.toString(),
    final_fee: final.toString(),
    decay: { kind: "fixed_base_q128", half_life_seconds: 600 },
    phase,
    fee_rate: rate.toString(),
    evaluated_at: seconds(indexedTime),
  };
}

function feePhase(start: bigint, end: bigint, time: bigint) {
  if (time < start) return "before_trading_start";
  if (time < end) return "fee_decay";
  return "final_fee";
}
