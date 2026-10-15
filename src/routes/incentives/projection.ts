// Reference implementation of the next-day incentive estimate for one
// position, for clients to port. Nothing in the API calls it.
//
// It answers: if the pool price, every position's liquidity and the pair's
// daily budget stayed as they are now for the next 24 hours, roughly how much
// would this position earn? Inputs are the /campaigns pair (depth_percent,
// depth0, depth1, daily_rewards_token0, daily_rewards_token1), the position's
// pool key, bounds and liquidity, and the pool's current tick.
//
// Canonical scoring (compute_rewards_for_period_v1, indexer migration 00088)
// splits each period's token0 budget by every eligible position's token0 depth
// above the price and the token1 budget by token1 depth below it, summed over
// every eligible pool of the pair (all fee tiers and allowed extensions on the
// campaign's core), so the competition is the pair, not the pool. It weights
// depth with a Gaussian of the pair's realized volatility out to about three
// standard deviations, shifts it by the pool fee, and integrates over the
// period's price path.
//
// depth0 and depth1 measure the same pair-wide depth with a flat band instead:
// liquidity between the fee and depth_percent away from each pool's recent
// median tick (pool_market_depth_view). This estimate measures the position
// with exactly that band, so numerator and denominator use the same kernel.
// It therefore differs from canonical scoring by the kernel shape: liquidity
// beyond depth_percent (about two standard deviations) counts for nothing
// here, and liquidity close to the price counts for less than canonically.
// That, the frozen price and the frozen competition are why the result is a
// conditional estimate and never an amount owed.

const LOG_TICK = Math.log(1.000001);
const SQRT_TICK = 1.0000005;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProjectionCampaign {
  chainId: bigint;
  coreAddress: bigint;
  allowedLockers: bigint[] | null;
  allowedExtensions: bigint[];
  startTime: Date;
  endTime: Date | null;
}

export interface ProjectionPair {
  token0: bigint;
  token1: bigint;
  depthPercent: number | null;
  depth0: bigint | null;
  depth1: bigint | null;
  dailyRewardsToken0: bigint;
  dailyRewardsToken1: bigint;
}

export interface ProjectionPosition {
  chainId: bigint;
  coreAddress: bigint;
  locker: bigint;
  token0: bigint;
  token1: bigint;
  extension: bigint;
  fee: bigint;
  feeDenominator: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  includedInDepth: boolean;
}

export type Projection =
  | {
      status: "estimated";
      amount: bigint;
      share0: number;
      share1: number;
    }
  | {
      status: "ineligible" | "unsupported" | "unknown";
      reason: string;
    };

const skip = (
  status: "ineligible" | "unsupported" | "unknown",
  reason: string,
): Projection => ({ status, reason });

function running(campaign: ProjectionCampaign, now: Date): Projection | null {
  if (campaign.startTime > now) return skip("ineligible", "not started");
  if (campaign.endTime !== null && campaign.endTime <= now)
    return skip("ineligible", "ended");
  return null;
}

function eligibility(
  campaign: ProjectionCampaign,
  pair: ProjectionPair,
  position: ProjectionPosition,
): Projection | null {
  if (position.chainId !== campaign.chainId)
    return skip("ineligible", "another chain");
  if (position.coreAddress !== campaign.coreAddress)
    return skip("ineligible", "another core");
  if (
    campaign.allowedLockers !== null &&
    !campaign.allowedLockers.includes(position.locker)
  )
    return skip("ineligible", "locker not allowed");
  if (!campaign.allowedExtensions.includes(position.extension))
    return skip("ineligible", "extension not allowed");
  if (position.token0 !== pair.token0 || position.token1 !== pair.token1)
    return skip("ineligible", "another pair");
  return null;
}

function supported(
  campaign: ProjectionCampaign,
  pair: ProjectionPair,
  now: Date,
): Projection | null {
  if (
    campaign.endTime !== null &&
    campaign.endTime.getTime() < now.getTime() + DAY_MS
  )
    return skip("unsupported", "campaign ends within the next 24 hours");
  if (campaign.allowedLockers !== null)
    return skip("unsupported", "campaign restricts lockers");
  if (
    pair.depthPercent === null ||
    pair.depth0 === null ||
    pair.depth1 === null
  )
    return skip("unknown", "no depth for the pair");
  return null;
}

function amount0(liquidity: number, lower: number, upper: number) {
  if (upper <= lower) return 0;
  return liquidity * (SQRT_TICK ** -lower - SQRT_TICK ** -upper);
}

function amount1(liquidity: number, lower: number, upper: number) {
  if (upper <= lower) return 0;
  return liquidity * (SQRT_TICK ** upper - SQRT_TICK ** lower);
}

const share = (mine: number, depth: bigint, included: boolean) => {
  const total = Number(depth) + (included ? 0 : mine);
  return total > 0 ? mine / total : 0;
};

export function projectNextDayReward(
  campaign: ProjectionCampaign,
  pair: ProjectionPair,
  position: ProjectionPosition,
  referenceTick: number,
  now: Date,
): Projection {
  const blocked =
    eligibility(campaign, pair, position) ??
    running(campaign, now) ??
    supported(campaign, pair, now);
  if (blocked) return blocked;

  const depthTicks = Math.floor(Math.log1p(pair.depthPercent!) / LOG_TICK);
  const feeTicks = Math.ceil(
    Math.log1p(Number(position.fee) / Number(position.feeDenominator)) /
      LOG_TICK,
  );
  if (feeTicks >= depthTicks)
    return skip("unsupported", "pool fee is wider than the depth band");

  const liquidity = Number(position.liquidity);
  const { tickLower, tickUpper, includedInDepth } = position;
  const mine0 = amount0(
    liquidity,
    Math.max(tickLower, referenceTick + feeTicks),
    Math.min(tickUpper, referenceTick + depthTicks),
  );
  const mine1 = amount1(
    liquidity,
    Math.max(tickLower, referenceTick - depthTicks),
    Math.min(tickUpper, referenceTick - feeTicks),
  );
  const share0 = share(mine0, pair.depth0!, includedInDepth);
  const share1 = share(mine1, pair.depth1!, includedInDepth);
  const amount = Math.floor(
    share0 * Number(pair.dailyRewardsToken0) +
      share1 * Number(pair.dailyRewardsToken1),
  );
  return { status: "estimated", amount: BigInt(amount), share0, share1 };
}
