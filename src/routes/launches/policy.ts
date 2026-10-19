import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

export const ABI_SHA256 =
  "189ff93c0f6fb64f6e7dd0675872bf6686692f8303e6218b8c2521bfa5ced215";
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

// Constructor-executed LOCAL instances in indexer 76c42bf / fixture 41d416ce.
// No live instance exists. Never enable these via a hosted configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    address: "0x510d7c117adeeb89bb33b9acb53995f3280eaa3a",
    core: CORE,
    quote: "0xffffffffffffffffffffffffffffffffffffffff",
    runtime:
      "0x8d8839b97583f275a84aaf26cd6a5fa3ba21a7be04731a65f6140fc5040477c4",
    quoteRuntime: WETH_RUNTIME,
    abiSha256: ABI_SHA256,
  },
  {
    chainId: "31337",
    address: "0x5195c03d30c11be73485ab76a35eb6f59fc52072",
    core: CORE,
    quote: "0x0000000000000000000000000000000000010000",
    runtime:
      "0x8751bab213ba226c4e45f6441b9df2db1f9c8ee9e9335320e180f3b348646014",
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

export function feeSchedule(input: {
  start: bigint;
  duration: bigint;
  initial: bigint;
  final: bigint;
  indexedTime: bigint;
}): z.infer<typeof FeeSchedule> {
  const { start, duration, initial, final, indexedTime } = input;
  [start, duration, initial, final, indexedTime].forEach(uint64);
  if (duration === 0n || final > initial) {
    throw new Error("Invalid indexed fee schedule");
  }
  const end = uint64(start + duration);
  const phase = feePhase(start, end, indexedTime);
  const elapsed = indexedTime > start ? indexedTime - start : 0n;
  // Contract floors the decrement (not the remaining fee).
  const rate =
    indexedTime >= end
      ? final
      : initial - ((initial - final) * elapsed) / duration;
  return {
    trading_start: seconds(start),
    fee_duration: seconds(duration),
    fee_end: seconds(end),
    initial_fee: initial.toString(),
    final_fee: final.toString(),
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
