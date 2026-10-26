import { z } from "@hono/zod-openapi";
import { FeeSchedule } from "./schema";

// sha256 of the compiled ABI JSON files of the final source freeze,
// evm-contracts 853b608ec26d4c80bdad6e394cb8ba686e1ae615 (SHA256SUMS.json of
// the freeze; copies in ./vectors/PROVENANCE.md).
export const SOURCE_COMMIT = "853b608ec26d4c80bdad6e394cb8ba686e1ae615";
export const ABI_SHA256 =
  "6a131c2d2f70f85a5e2a54395b9d77c4dd5028a7a4bbf632f3d3364ac61e56eb";
export const PERIPHERY_ABI_SHA256 =
  "5d05426f8190cb0bcd6a021e7aceb46f468708cb36bd5a5d818548650499c839";
const NATIVE = "0x0000000000000000000000000000000000000000" as const;

/**
 * An extension and the periphery that forwards to it. An instance has no
 * quote: every launch names its own (LaunchParameters.quoteToken).
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

// The final contract has no deployment, so no hosted instance exists. These
// are the LOCAL instances of the indexer's replay fixture (anvil, no fork),
// accepted only by the explicit local harness. Never enable them through a
// hosted configuration.
export const LOCAL_INSTANCES: readonly LaunchInstance[] = [
  {
    chainId: "31337",
    address: "0x51c4ad945fbef67859d92f1690cbf86df12e3b7c",
    runtime:
      "0xa66e365089d80b017edeb98237831260bf9e1b7d5f3965d42be5672de6b0d70e",
    periphery: "0x6963de1652c96fb0eaeaf5167de3c89e187284f2",
    peripheryRuntime:
      "0x208c314d799d9898e145881eefdf715d0620f13cfb343951987aba8fb8ba8363",
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
  pins: readonly LaunchInstance[] = LOCAL_INSTANCES,
): readonly LaunchInstance[] {
  return reviewed(requested, pins, localHarness);
}

/** ERC-20 quotes bound by chain, address and runtime; empty when hosted. */
export function supportedQuotes(
  requested: readonly LaunchQuote[],
  localHarness: boolean,
  pins: readonly LaunchQuote[] = LOCAL_QUOTES,
): readonly LaunchQuote[] {
  return reviewed(requested, pins, localHarness);
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

export const SINK_HOLDER = NATIVE;
const MAX_SUPPLY = 10n ** 30n;

/**
 * requested (LaunchParameters.supply, totalSupply), installed (in the
 * position) and sink (minted to address 0). Anything outside
 * 0 < installed <= requested <= 10^30 with sink = requested - installed is
 * malformed indexed data.
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
    requested > MAX_SUPPLY ||
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

/**
 * The content of a canonical LibString.packOne word: byte 0 is the length
 * (1..31), then the content, then zeros. Returns the UTF-8 text, or null
 * when the content is not valid UTF-8. A non-canonical word is malformed
 * indexed data: the contract refuses it.
 */
export function unpackString(word: bigint): string | null {
  if (word < 0n || word >= 1n << 256n) throw new Error("Invalid packed word");
  const length = Number(word >> 248n);
  const tailBits = BigInt(8 * (31 - length));
  if (length === 0 || length > 31 || (word & ((1n << tailBits) - 1n)) !== 0n) {
    throw new Error("Invalid indexed packed string");
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++)
    bytes[i] = Number((word >> BigInt(8 * (30 - i))) & 0xffn);
  return utf8OrNull(bytes);
}

/** UTF-8 text of `bytes`, null when empty or not valid UTF-8. Never rewritten. */
export function utf8OrNull(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

/** Derived spacing and signed-aligned economic bounds of the installation. */
export function alignedRange(ask: number, upper: number) {
  if (!(ask < upper)) throw new Error("Invalid indexed ticks");
  const spacing = Math.floor((upper - ask + 255) / 256);
  return {
    tick_spacing: spacing,
    aligned_ask_tick: Math.ceil(ask / spacing) * spacing,
    aligned_upper_tick: Math.floor(upper / spacing) * spacing,
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
export function seconds(value: bigint) {
  uint64(value);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Indexed time exceeds exact JSON integer domain");
  }
  return Number(value);
}

const Q128 = 1n << 128n;
/** Largest tick magnitude of the contracts' tick helper. */
export const MAX_TICK_MAGNITUDE = 88722835n;
/** (MAX_TICK_MAGNITUDE + 1) * 2^32 - 1: the saturation numerator. */
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
 * feeAt of the contract in its normative order: initial before and at the
 * start and for rate 0; elapsed > MAX_DECAY_PRODUCT / rate (integer division
 * first) is final, the floor; otherwise
 * final + floor((initial - final) * tickFactorQ128(floor(rate * elapsed / 2^32)) / 2^128).
 */
export function feeAt(
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

/** The served schedule; anything outside the contract's domain is malformed (500). */
export function feeSchedule(input: {
  start: bigint;
  initial: bigint;
  final: bigint;
  rate: bigint;
  time: bigint;
}): z.infer<typeof FeeSchedule> {
  const { start, initial, final, rate, time } = input;
  [start, initial, final, rate, time].forEach(uint64);
  if (final > initial) throw new Error("Invalid indexed fee schedule");
  const fee = feeAt(initial, final, rate, time - start);
  let phase: z.infer<typeof FeeSchedule>["phase"];
  if (time < start) phase = "before_trading_start";
  else if (fee === final) phase = "at_floor";
  else if (rate === 0n) phase = "constant";
  else phase = "decaying";
  return {
    trading_start: seconds(start),
    initial_fee: initial.toString(),
    final_fee: final.toString(),
    decay_rate_x32: rate.toString(),
    half_life_seconds: halfLifeSeconds(rate),
    saturation_elapsed_seconds:
      rate === 0n ? null : (MAX_DECAY_PRODUCT / rate).toString(),
    phase,
    fee_rate: fee.toString(),
    evaluated_at: seconds(time),
  };
}

/** upcoming before trading_start, trading from it on. */
export function launchStatus(start: bigint, time: bigint) {
  return time < start ? ("upcoming" as const) : ("trading" as const);
}

/**
 * Raw quote per raw launch token times 2^128, floored, from Core's Q128
 * sqrt ratio (token1 per token0).
 */
export function priceX128(sqrtRatio: bigint, launchIsToken1: boolean) {
  if (sqrtRatio <= 0n) throw new Error("Invalid indexed sqrt ratio");
  const square = sqrtRatio * sqrtRatio;
  return launchIsToken1 ? (1n << 384n) / square : square >> 128n;
}

/** floor(fraction * 10^18) of numerator / denominator as "d.dddddddddddddddddd". */
export function share18(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n || numerator > denominator)
    throw new Error("Invalid indexed share");
  const scaled = (numerator * 10n ** 18n) / denominator;
  return `${scaled / 10n ** 18n}.${(scaled % 10n ** 18n).toString().padStart(18, "0")}`;
}

/**
 * Market data from the indexed Core state: price, market cap (price times
 * totalSupply), raised quote and the sold launch tokens.
 */
export function marketData(input: {
  sqrtRatio: bigint;
  tick: number;
  launchIsToken1: boolean;
  totalSupply: bigint;
  installed: bigint;
  tokenReserve: bigint;
  quoteReserve: bigint;
  marketCapUsd: string | null;
  tradeCount: bigint;
  volume: bigint;
  volumeUsd: string | null;
}) {
  const price = priceX128(input.sqrtRatio, input.launchIsToken1);
  const left =
    input.tokenReserve > input.installed ? input.installed : input.tokenReserve;
  if (input.tokenReserve < 0n || input.quoteReserve < 0n)
    throw new Error("Invalid indexed reserves");
  const sold = input.installed - left;
  return {
    price_tick: input.launchIsToken1 ? -input.tick : input.tick,
    price_x128: price.toString(),
    market_cap: ((price * input.totalSupply) >> 128n).toString(),
    market_cap_usd: input.marketCapUsd,
    raised: input.quoteReserve.toString(),
    sold: sold.toString(),
    sold_share: share18(sold, input.installed),
    trade_count: Number(input.tradeCount),
    volume: input.volume.toString(),
    volume_usd: input.volumeUsd,
  };
}
