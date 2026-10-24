import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

// sha256 of `jq -cS .abi` (no trailing newline) of the evm-contracts 43d6628
// build, as in the protocol manifest.
export const ABI_SHA256 =
  "efae9388aa6b1342479204ddf436fd2a310df16bf06c80c990b2d22c90d1e41e";
export const PERIPHERY_ABI_SHA256 =
  "df24d9f07d45323da7e46c0f6e64ce24f8f522442d60cb07880ddf742ebe7305";
// The same of the tick-rate revision, evm-contracts 3d6378f.
export const V2_ABI_SHA256 =
  "89ff4d15e5e8b4f044c4804d460df915e9206bbdbdcef22cf4afe0fbbf4eaadd";
export const V2_PERIPHERY_ABI_SHA256 =
  "a6d43b362d04eeb4e636ee32a031fc06995a2fd8bb71fb63750f27836a0ddb07";

/**
 * The fee math of a deployment's contract revision, fixed for its life and
 * never inferred from a row: fixed_base_duration_v1 is evm-contracts 43d6628
 * (uint32 feeDuration), tick_rate_v2 is 3d6378f (uint64 decayRateX32).
 */
export type FeeModel = "fixed_base_duration_v1" | "tick_rate_v2";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;

/**
 * An extension and the periphery that forwards to it. An instance has no
 * quote: every launch names its own (LaunchParameters.quoteToken), and one
 * instance serves native ETH and ERC-20 quotes alike.
 */
export interface LaunchInstance {
  chainId: string;
  feeModel: FeeModel;
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

// The constructor-executed LOCAL instances of the indexer replay fixtures
// (anvil, no fork), one per fee model: evm-contracts 43d6628
// (local-chain.json) and 3d6378f (local-chain-v2.json), each serving native-ETH
// and ERC-20 quote launches. No live instance exists. Never enable them via a
// hosted configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    feeModel: "fixed_base_duration_v1",
    address: "0x519c5f793d3f6cf9ee439e4cc38d8285cf08211f",
    runtime:
      "0xd6b4c7ce8da56e9948fdb004a035d9b52dbd3690bcb03c1269bbf2a9981d8ed5",
    periphery: "0x0df4e2a76640b52e51479b435f52d0eb0e7e8ef4",
    peripheryRuntime:
      "0x2a9329dbb064a2c031115c7c120c8b6a1f31de167f33374180e4dc73d975974b",
    core: "0x00000000000014aa86c5d3c41765bb24e11bd701",
    abiSha256: ABI_SHA256,
    peripheryAbiSha256: PERIPHERY_ABI_SHA256,
  },
  {
    chainId: "31337",
    feeModel: "tick_rate_v2",
    address: "0x5135fd3e9a6056937eaf6b99454bbc2198c2263d",
    runtime:
      "0xe08ad382497fc9825956c2b4e9ccf463014c4ed65baf50c0a59db8d7b7aedfc3",
    periphery: "0xfb2e7927d3e4984dca3e390526d43c6f5a3461e9",
    peripheryRuntime:
      "0xf72d3cd6b99e1b64f0b08c0f6933b4f8adb92464ded48c51bfb7d2805c09d667",
    core: "0x00000000000014aa86c5d3c41765bb24e11bd701",
    abiSha256: V2_ABI_SHA256,
    peripheryAbiSha256: V2_PERIPHERY_ABI_SHA256,
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
  row: Pick<
    LaunchInstance,
    "chainId" | "feeModel" | "address" | "periphery" | "core"
  > & {
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
        pin.feeModel === row.feeModel &&
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

/** Largest tick magnitude of the contracts' tick helper. */
export const MAX_TICK_MAGNITUDE = 88722835n;
/** (MAX_TICK_MAGNITUDE + 1) * 2^32 - 1 (math/feeDecay.sol at 3d6378f). */
export const MAX_DECAY_PRODUCT = ((MAX_TICK_MAGNITUDE + 1n) << 32n) - 1n;
/**
 * floor(2 * ln 2 / ln 1.000001 * 2^32 * 10^30): ticks per half-life of the
 * excess, Q32.32, scaled by 10^30. The normative integer for every half-life
 * conversion; never a float.
 */
export const HALF_LIFE_X32_E30 =
  5954091920683119788732747343471285361579197626n;
/** The bit constants of tickToSqrtRatio for negative ticks (math/ticks.sol). */
const TICK_MASKS: readonly bigint[] = [
  340282196779882608775400081051345954875n,
  340282026638911824551550055881712329744n,
  340281686357225467326082729798982530761n,
  340281005794873596573094710012989410072n,
  340279644674253220331048947518555486588n,
  340276922449345852680114346161748269428n,
  340271478064864046934932689706268169160n,
  340260589557227275536970734808027446368n,
  340238813587222069206590352882444122789n,
  340195265827972829906238800850533898084n,
  340108187030021964395011332102514443192n,
  339934096296338836553381438728885759063n,
  339586182118148867994722769619739863337n,
  338891421642114786711725022995822495130n,
  337506162020136007223375792700736547955n,
  334752606878476170032608184381010470119n,
  329312708224965356314372077522414179198n,
  318696677643769341895946499718036526719n,
  298480268784467865547185399201474874621n,
  261813363001402740542020888190605903085n,
  201439286044552466954512953679502885114n,
  119247395418425876229630149779831629514n,
  41788651709309085859755118322591422179n,
  5131889223303998677939799486543748348n,
  77395391476111124436543048938586576n,
  17603164912545197391926702422886n,
  910630244353091011850553n,
];

/**
 * toFixed(tickToSqrtRatio(-magnitude)): from 2^128, multiply by the constant
 * of every set bit in ascending order and floor after each multiply, then
 * round down to the compact 94-bit mantissa of its region.
 */
export function tickFactorQ128(magnitude: bigint): bigint {
  if (magnitude < 0n || magnitude > MAX_TICK_MAGNITUDE)
    throw new Error("Tick magnitude out of range");
  let ratio = Q128;
  TICK_MASKS.forEach((mask, bit) => {
    if ((magnitude >> BigInt(bit)) & 1n) ratio = (ratio * mask) >> 128n;
  });
  const shift = ratio >= Q128 ? 66n : ratio >= 1n << 96n ? 34n : 2n;
  return (ratio >> shift) << shift;
}

/**
 * decayedFee of the tick-rate contract (evm-contracts 3d6378f) in its
 * normative order: rate 0 is initial; elapsed > MAX_DECAY_PRODUCT / rate
 * (integer division first) is final, the floor; otherwise
 * final + floor((initial - final) * tickFactorQ128(floor(rate * elapsed / 2^32)) / 2^128).
 */
export function tickRateDecayedFee(
  initial: bigint,
  final: bigint,
  rate: bigint,
  elapsed: bigint,
): bigint {
  if (elapsed <= 0n || rate === 0n) return initial;
  if (elapsed > MAX_DECAY_PRODUCT / rate) return final;
  return (
    final +
    (((initial - final) * tickFactorQ128((rate * elapsed) >> 32n)) >> 128n)
  );
}

/** decayRateX32 for a half-life of `seconds` (> 0): floor(HALF_LIFE_X32_E30 / (seconds * 10^30)). */
export function decayRateForHalfLife(seconds: bigint): bigint {
  if (seconds <= 0n) throw new Error("Half-life must be positive");
  return HALF_LIFE_X32_E30 / (seconds * 10n ** 30n);
}

/** The half-life of the excess, 6 fractional digits, floored; null for rate 0. Display only. */
export function halfLifeSeconds(rate: bigint): string | null {
  if (rate === 0n) return null;
  const micros = HALF_LIFE_X32_E30 / (rate * 10n ** 24n);
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${micros / 1_000_000n}.${fraction}`;
}

type FeeScheduleInput = {
  start: bigint;
  initial: bigint;
  final: bigint;
  indexedTime: bigint;
} & (
  | { model: "fixed_base_duration_v1"; duration: bigint }
  | { model: "tick_rate_v2"; rate: bigint }
);

/**
 * The served schedule of an indexed launch, by its deployment's fee model.
 * Anything outside the model's domain is malformed indexed data (500).
 */
export function feeSchedule(
  input: FeeScheduleInput,
): z.infer<typeof FeeSchedule> {
  const { start, initial, final, indexedTime } = input;
  [start, initial, final, indexedTime].forEach(uint64);
  if (final > initial) throw new Error("Invalid indexed fee schedule");
  if (input.model === "tick_rate_v2") return tickRateSchedule(input);
  if (input.model !== "fixed_base_duration_v1")
    throw new Error("Invalid indexed fee model");
  const { duration } = input;
  uint64(duration);
  if (duration === 0n || duration > 0xffffffffn) {
    throw new Error("Invalid indexed fee schedule");
  }
  const end = uint64(start + duration);
  const phase = feePhase(start, end, indexedTime);
  const elapsed = indexedTime > start ? indexedTime - start : 0n;
  const rate = decayedFee(initial, final, duration, elapsed);
  return {
    model: "fixed_base_duration_v1",
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

/** v2: final_fee is a floor that is approached; there is no end time. */
function tickRateSchedule(
  input: FeeScheduleInput & { model: "tick_rate_v2" },
): z.infer<typeof FeeSchedule> {
  const { start, initial, final, indexedTime, rate } = input;
  uint64(rate);
  const fee = tickRateDecayedFee(initial, final, rate, indexedTime - start);
  let phase: "before_trading_start" | "at_floor" | "constant" | "decaying";
  if (indexedTime < start) phase = "before_trading_start";
  else if (fee === final) phase = "at_floor";
  else if (rate === 0n) phase = "constant";
  else phase = "decaying";
  return {
    model: "tick_rate_v2",
    trading_start: seconds(start),
    initial_fee: initial.toString(),
    final_fee: final.toString(),
    decay_rate_x32: rate.toString(),
    half_life_seconds: halfLifeSeconds(rate),
    saturation_elapsed_seconds:
      rate === 0n ? null : (MAX_DECAY_PRODUCT / rate).toString(),
    phase,
    fee_rate: fee.toString(),
    evaluated_at: seconds(indexedTime),
  };
}

function feePhase(start: bigint, end: bigint, time: bigint) {
  if (time < start) return "before_trading_start";
  if (time < end) return "fee_decay";
  return "final_fee";
}
