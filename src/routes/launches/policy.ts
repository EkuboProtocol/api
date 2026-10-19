import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

export const ABI_SHA256 =
  "bc51b39284a5a2a0970d3a804420762ce291dc01f9c21ddf31840e354a3792bb";
export const POLICY_SHA256 =
  "7864a2d33a0fa8964922a5225653ed19842c590091f289eb4e29306feac6f6e1";
const CORE = "0x00000000000014aa86c5d3c41765bb24e11bd701";
const WETH_RUNTIME =
  "0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c";

export interface LaunchInstance {
  chainId: string;
  address: string;
  core: string;
  quote: string;
  runtime: string;
  quoteRuntime: string;
  abiSha256: string;
}

// Constructor-executed LOCAL instances in indexer cdf58fc / fixture b4026bee
// (evm-contracts b1cbb1c1, draft exponential creator-fee decay).
// No live instance exists. Never enable these via a hosted configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    address: "0x5142e167b32877ca3cf3060010a0a1418e3ef1b9",
    core: CORE,
    quote: "0xffffffffffffffffffffffffffffffffffffffff",
    runtime:
      "0x8fb360bb48006819049e6b9a53679ccaa01264e61465ce8e8cd2e8b185d3a8d1",
    quoteRuntime: WETH_RUNTIME,
    abiSha256: ABI_SHA256,
  },
  {
    chainId: "31337",
    address: "0x51174b5db84c81a906ec55445070fd84c8c8e655",
    core: CORE,
    quote: "0x0000000000000000000000000000000000010000",
    runtime:
      "0xa951db07ad354ea45df3ff1b720b69c7cc588c4feb44aaea79cd79639da61f6e",
    quoteRuntime: WETH_RUNTIME,
    abiSha256: ABI_SHA256,
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
  row: Pick<LaunchInstance, "chainId" | "address" | "core" | "quote">,
  enabled: readonly LaunchInstance[],
): boolean {
  return enabled.some(
    (pin) =>
      pin.chainId === row.chainId &&
      pin.address === row.address &&
      pin.core === row.core &&
      pin.quote === row.quote,
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

const Q64 = 1n << 64n;

/**
 * powQ64 of the contract (math/feeDecay.sol): factor ** exponent in Q0.64 by
 * square-and-multiply, flooring after every multiply and squaring only while
 * bits remain. BigInt division floors for these non-negative operands.
 */
export function powQ64(factor: bigint, exponent: bigint): bigint {
  let result = Q64;
  let base = factor;
  let rest = exponent;
  while (rest !== 0n) {
    if ((rest & 1n) === 1n) result = (result * base) / Q64;
    rest >>= 1n;
    if (rest !== 0n) base = (base * base) / Q64;
  }
  return result;
}

/**
 * feeAt of the contract: initial until the start, then
 * final + floor((initial - final) * (b^t - b^D) / (2^64 - b^D)), then final.
 */
export function decayedFee(
  initial: bigint,
  final: bigint,
  factor: bigint,
  duration: bigint,
  elapsed: bigint,
): bigint {
  if (elapsed === 0n) return initial;
  if (elapsed >= duration) return final;
  const endpoint = powQ64(factor, duration);
  return (
    final +
    ((initial - final) * (powQ64(factor, elapsed) - endpoint)) /
      (Q64 - endpoint)
  );
}

export function feeSchedule(input: {
  start: bigint;
  duration: bigint;
  initial: bigint;
  final: bigint;
  decayFactor: bigint;
  indexedTime: bigint;
}): z.infer<typeof FeeSchedule> {
  const { start, duration, initial, final, decayFactor, indexedTime } = input;
  [start, duration, initial, final, decayFactor, indexedTime].forEach(uint64);
  if (duration === 0n || final > initial || decayFactor === 0n) {
    throw new Error("Invalid indexed fee schedule");
  }
  const end = uint64(start + duration);
  const phase = feePhase(start, end, indexedTime);
  const elapsed = indexedTime > start ? indexedTime - start : 0n;
  const rate = decayedFee(initial, final, decayFactor, duration, elapsed);
  return {
    trading_start: seconds(start),
    fee_duration: seconds(duration),
    fee_end: seconds(end),
    initial_fee: initial.toString(),
    final_fee: final.toString(),
    decay_factor: decayFactor.toString(),
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
