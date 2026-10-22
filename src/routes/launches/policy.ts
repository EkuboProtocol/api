import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

// sha256 of `jq -cS .abi` (no trailing newline) of the evm-contracts 550afc4
// build, as in the protocol manifest.
export const ABI_SHA256 =
  "efae9388aa6b1342479204ddf436fd2a310df16bf06c80c990b2d22c90d1e41e";
export const PERIPHERY_ABI_SHA256 =
  "df24d9f07d45323da7e46c0f6e64ce24f8f522442d60cb07880ddf742ebe7305";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;

/**
 * An extension and the periphery that forwards to it. An instance has no
 * quote: every launch names its own (LaunchParameters.quoteToken), and one
 * instance serves native ETH and ERC-20 quotes alike.
 */
export interface LaunchInstance {
  chainId: string;
  address: string;
  runtime: string;
  periphery: string;
  peripheryRuntime: string;
  core: string;
  abiSha256: string;
  peripheryAbiSha256: string;
}

/** A reviewed ERC-20 quote. Native ETH (address 0) needs no entry. */
export interface LaunchQuote {
  chainId: string;
  address: string;
  runtime: string;
}

// The constructor-executed LOCAL instance of the indexer replay fixture
// (evm-contracts 550afc4, anvil, no fork), serving native-ETH and ERC-20
// quote launches. No live instance exists. Never enable it via a hosted
// configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    address: "0x511b4327c2a2b6fd803b4ae85f2f9d831e046d8b",
    runtime:
      "0xb8c6d15f45c41e9dc43ac0e6ab8ea941dc833514cdb0b82f381c65f42f73a858",
    periphery: "0x2f0be2fc5a2825cecd23dbf6ed33ed8ff823ef64",
    peripheryRuntime:
      "0x49988478ba70cc8d2587eb63141b333c7ef0a67c4639c3a2ee25de4c4597999e",
    core: "0x00000000000014aa86c5d3c41765bb24e11bd701",
    abiSha256: ABI_SHA256,
    peripheryAbiSha256: PERIPHERY_ABI_SHA256,
  },
];

// The fixture's plain 18-decimal test ERC-20 (evm-contracts
// test/TestToken.sol), relocated to the highest address so the launch token
// is token0. Local only; the hosted quote list is empty.
export const LOCAL_QUOTES: readonly LaunchQuote[] = [
  {
    chainId: "31337",
    address: "0xffffffffffffffffffffffffffffffffffffffff",
    runtime:
      "0xe8ccd7c4eb891208d5e04a27a31dfaf2b9bce01e083d7b36f10b6dd6ea643e63",
  },
];

function reviewed<T extends object>(
  requested: readonly T[],
  pins: readonly T[],
  localHarness: boolean,
): readonly T[] {
  if (!localHarness) return [];
  return requested.filter((request) =>
    pins.some((pin) =>
      (Object.keys(pin) as (keyof T)[]).every(
        (key) => pin[key] === request[key],
      ),
    ),
  );
}

/** An explicit local harness manifest, never an address-only allowlist. */
export function supportedInstances(
  requested: readonly LaunchInstance[],
  localHarness: boolean,
): readonly LaunchInstance[] {
  return reviewed(requested, LOCAL_INSTANCES, localHarness);
}

/** ERC-20 quotes bound by chain, address and runtime; empty when hosted. */
export function supportedQuotes(
  requested: readonly LaunchQuote[],
  localHarness: boolean,
): readonly LaunchQuote[] {
  return reviewed(requested, LOCAL_QUOTES, localHarness);
}

/** Native ETH, or an ERC-20 in the enabled quote list of the chain. */
export function supportedQuote(
  row: { chainId: string; quote: string; quoteKind: "native" | "erc20" },
  quotes: readonly LaunchQuote[],
): boolean {
  if (row.quoteKind === "native") return row.quote === NATIVE;
  return (
    row.quote !== NATIVE &&
    quotes.some((q) => q.chainId === row.chainId && q.address === row.quote)
  );
}

export function supportedLaunch(
  row: Pick<LaunchInstance, "chainId" | "address" | "periphery" | "core"> & {
    quote: string;
    quoteKind: "native" | "erc20";
  },
  enabled: readonly LaunchInstance[],
  quotes: readonly LaunchQuote[],
): boolean {
  return (
    enabled.some(
      (pin) =>
        pin.chainId === row.chainId &&
        pin.address === row.address &&
        pin.periphery === row.periphery &&
        pin.core === row.core,
    ) && supportedQuote(row, quotes)
  );
}

const INT128_MAX = (1n << 127n) - 1n;
export const SINK_HOLDER = NATIVE;

/**
 * The launch-token supply split: requested (LaunchParameters.supply, the
 * token's totalSupply), installed (in the position) and sink (minted to
 * address 0). Anything outside 0 < installed <= requested <= int128 max with
 * sink = requested - installed is malformed indexed data.
 */
export function launchSupply(input: {
  requested: bigint;
  installed: bigint;
  sink: bigint;
}) {
  const { requested, installed, sink } = input;
  if (
    installed <= 0n ||
    installed > requested ||
    requested > INT128_MAX ||
    sink !== requested - installed
  ) {
    throw new Error("Invalid indexed launch supply");
  }
  return {
    requested: requested.toString(),
    installed: installed.toString(),
    sink: sink.toString(),
    sink_holder: SINK_HOLDER,
  };
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
