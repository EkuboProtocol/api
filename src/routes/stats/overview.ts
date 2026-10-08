import { createRoute, z } from "@hono/zod-openapi";
import { defineRoute } from "../../shared/context";
import { createQueries } from "../../queries";
import { errorResponses } from "../../shared/errors";
import { jsonResponse } from "../../shared/openapi";
import { ChainIdType, HexStringType } from "../../shared/validation/address";
import toHex from "../../shared/toHex";
import {
  createTokenPricer,
  sumFields,
  sumUsdByChain,
  utcDateString,
} from "./usdTotals";

const TimestampType = z.union([z.date(), z.string()]);
const TokenIdentifierSchema = z.union([z.string(), z.number()]);

// Each colo sees a request only every so often, so a ten-minute lifetime alone
// would make most visitors wait for the full query. The edge serves the stale
// copy instead and refreshes it in the background (src/worker.ts).
const OVERVIEW_CACHE_CONTROL =
  "public, max-age=600, stale-while-revalidate=86400";

type VolumeRow = { token: string; volume: string; chain_id: bigint } & Partial<{
  fees: string;
  ve33_fees: string;
}>;
const normalizeVolumeRow = (row: VolumeRow) => ({
  token: toHex(row.token),
  volume: row.volume,
  fees: row.fees ?? "0",
  ve33_fees: row.ve33_fees ?? "0",
  chain_id: toHex(row.chain_id),
});

type RevenueByDateRow = {
  token: string;
  chain_id: bigint;
} & Partial<{ date: string | Date; revenue: string; volume: string }>;

const normalizeRevenueByDateRow = (row: RevenueByDateRow) => ({
  token: toHex(row.token),
  date: row.date ?? new Date(0),
  revenue: row.revenue ?? row.volume ?? "0",
  chain_id: toHex(row.chain_id),
});

type TvlDeltaRow = {
  token: string;
  date: string | Date;
  chain_id: bigint;
} & Partial<{ delta: string; balance: string }>;

const normalizeTvlDeltaRow = (row: TvlDeltaRow) => ({
  token: toHex(row.token),
  date: row.date,
  delta: row.delta ?? row.balance ?? "0",
  chain_id: toHex(row.chain_id),
});

const OverviewPairEntryType = z.object({
  chain_id: HexStringType,
  token0: TokenIdentifierSchema,
  token1: TokenIdentifierSchema,
  volume0_24h: z.string(),
  volume1_24h: z.string(),
  fees0_24h: z.string(),
  fees1_24h: z.string(),
  ve33_fees0_24h: z.string(),
  ve33_fees1_24h: z.string(),
  tvl0_total: z.string(),
  tvl1_total: z.string(),
  tvl0_delta_24h: z.string(),
  tvl1_delta_24h: z.string(),
  depth0: z.string(),
  depth1: z.string(),
  min_depth_percent: z.number().nullable(),
});

const OverviewPairsResponseType = z.object({
  topPairs: z.array(OverviewPairEntryType),
});

const BoostedFeesStateType = z
  .object({
    donate_rate0: z.string(),
    donate_rate1: z.string(),
    last_donated_time: z.number().int().min(0),
    future_donation_deltas: z.array(
      z.object({
        time: z.number().int().min(0),
        donate_rate_delta0: z.string(),
        donate_rate_delta1: z.string(),
      }),
    ),
  })
  .nullable();

const BoostedFeesPoolEntryType = z.object({
  chain_id: HexStringType,
  token0: HexStringType,
  token1: HexStringType,
  pool_id: z.string(),
  fee: z.string(),
  tick_spacing: z.number().int().nullable(),
  core_address: z.string(),
  extension: z.string(),
  volume0_24h: z.string(),
  volume1_24h: z.string(),
  fees0_24h: z.string(),
  fees1_24h: z.string(),
  ve33_fees0_24h: z.string(),
  ve33_fees1_24h: z.string(),
  tvl0_total: z.string(),
  tvl1_total: z.string(),
  tvl0_delta_24h: z.string(),
  tvl1_delta_24h: z.string(),
  depth0: z.string(),
  depth1: z.string(),
  depth_percent: z.number().nullable(),
  stableswap_params: z
    .object({
      center_tick: z.number().int(),
      amplification: z.number().int(),
    })
    .nullable(),
  boosts: BoostedFeesStateType,
});

const OverviewBoostedFeesPoolsResponseType = z.object({
  pools: z.array(BoostedFeesPoolEntryType),
});

const RevenueEntryType = z.object({
  token: z.string(),
  revenue: z.string(),
  chain_id: HexStringType,
});

const RevenueByDateEntryType = RevenueEntryType.extend({
  date: TimestampType,
});

const OverviewRevenueResponseType = z.object({
  revenueByTokenByDate: z.array(RevenueByDateEntryType),
  revenueByToken_24h: z.array(RevenueEntryType),
});

const VolumeEntryType = z.object({
  token: z.string(),
  volume: z.string(),
  fees: z.string(),
  ve33_fees: z.string(),
  chain_id: HexStringType,
});

const VolumeByDateEntryType = VolumeEntryType.extend({
  date: TimestampType,
});

const UsdAmountType = z.number();

const VolumeTotalsType = z.object({
  volumeUsd24h: UsdAmountType.describe(
    "USD value of volumeByToken_24h, using the latest token prices; unpriced tokens count as 0",
  ),
});

const OverviewVolumeResponseType = z.object({
  volumeByTokenByDate: z.array(VolumeByDateEntryType),
  volumeByToken_24h: z.array(VolumeEntryType),
  totals: VolumeTotalsType,
  totalsByChain: z
    .array(VolumeTotalsType.extend({ chain_id: HexStringType }))
    .describe("The same totals per chain, sorted by chain_id"),
});

const TvlEntryType = z.object({
  token: z.string(),
  balance: z.string(),
  chain_id: HexStringType,
});

const TvlDeltaEntryType = z.object({
  token: z.string(),
  date: TimestampType,
  delta: z.string(),
  chain_id: HexStringType,
});

const TvlTotalsType = z.object({
  tvlUsd: UsdAmountType.describe(
    "USD value of tvlByToken, using the latest token prices; unpriced tokens count as 0",
  ),
  tvlDeltaUsdYesterday: UsdAmountType.describe(
    "USD value of the tvlDeltaByTokenByDate entries dated tvlDeltaDate, at the latest token prices",
  ),
});

const OverviewTvlResponseType = z.object({
  tvlByToken: z.array(TvlEntryType),
  tvlDeltaByTokenByDate: z.array(TvlDeltaEntryType),
  totals: TvlTotalsType.extend({
    tvlDeltaDate: z
      .string()
      .describe(
        "The UTC date (YYYY-MM-DD) summed into tvlDeltaUsdYesterday: the day before the response was computed",
      ),
  }),
  totalsByChain: z
    .array(TvlTotalsType.extend({ chain_id: HexStringType }))
    .describe("The same totals per chain, sorted by chain_id"),
});

const TVL_TOTAL_FIELDS = ["tvlUsd", "tvlDeltaUsdYesterday"] as const;
const VOLUME_TOTAL_FIELDS = ["volumeUsd24h"] as const;

const MinTvlQueryParameter = z.coerce.number().min(0).default(1_000);

const ChainIdQuery = z.object({ chainId: ChainIdType.optional() });

export const GetOverviewPairs = defineRoute(
  createRoute({
    method: "get",
    path: "/overview/pairs",
    tags: ["Stats"],
    summary: "Get pairs",
    description: "Returns stats for the top pairs",
    operationId: "get_GetOverviewPairs",
    request: {
      query: z.object({
        chainId: ChainIdType.optional(),
        minTvlUsd: MinTvlQueryParameter.describe(
          "Minimum USD TVL required for a pair to be included",
        ),
      }),
    },
    responses: {
      200: jsonResponse(
        "The stats for the protocols top pairs",
        OverviewPairsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId, minTvlUsd } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const topPairs = await queries.getTopPairs(chainId ?? null, minTvlUsd);

    const response = {
      topPairs: topPairs.map((tp) => ({
        ...tp,
        token0: toHex(tp.token0),
        token1: toHex(tp.token1),
        chain_id: toHex(tp.chain_id),
      })),
    } satisfies z.infer<typeof OverviewPairsResponseType>;

    return c.json(response, 200, {
      "cache-control": OVERVIEW_CACHE_CONTROL,
    });
  },
);

export const GetOverviewBoostedFeesPools = defineRoute(
  createRoute({
    method: "get",
    path: "/overview/boosted-fees-pools",
    tags: ["Stats"],
    summary: "Get boosted fees pools",
    description:
      "Returns pools with boosted fees state, including current and scheduled donation deltas",
    operationId: "get_GetOverviewBoostedFeesPools",
    request: {
      query: ChainIdQuery,
    },
    responses: {
      200: jsonResponse(
        "Pools with boosted fees data",
        OverviewBoostedFeesPoolsResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { chainId } = c.req.valid("query");
    const queries = await createQueries(c.env);

    const pools = await queries.getBoostedFeesPools(chainId ?? null);

    const response = {
      pools: pools.map((pool) => {
        const {
          chain_id,
          token0,
          token1,
          boosted_fees_donate_rate0,
          boosted_fees_donate_rate1,
          boosted_fees_last_donated_time,
          boosted_fees_future_deltas,
          stableswap_amplification,
          stableswap_center_tick,
          ...rest
        } = pool;

        const stableswap_params =
          stableswap_amplification !== null && stableswap_center_tick !== null
            ? {
                center_tick: Number(stableswap_center_tick),
                amplification: Number(stableswap_amplification),
              }
            : null;

        return {
          ...rest,
          chain_id: toHex(chain_id),
          token0: toHex(token0),
          token1: toHex(token1),
          stableswap_params,
          boosts:
            boosted_fees_last_donated_time === null
              ? null
              : {
                  donate_rate0: boosted_fees_donate_rate0 ?? "0",
                  donate_rate1: boosted_fees_donate_rate1 ?? "0",
                  last_donated_time:
                    boosted_fees_last_donated_time.getTime() / 1000,
                  future_donation_deltas: (
                    boosted_fees_future_deltas ?? []
                  ).map((delta) => ({
                    time: Number(delta.time),
                    donate_rate_delta0: delta.donate_rate_delta0,
                    donate_rate_delta1: delta.donate_rate_delta1,
                  })),
                },
        };
      }),
    } satisfies z.infer<typeof OverviewBoostedFeesPoolsResponseType>;

    return c.json(response, 200, {
      "cache-control": OVERVIEW_CACHE_CONTROL,
    });
  },
);

export const GetOverviewRevenue = defineRoute(
  createRoute({
    method: "get",
    path: "/overview/revenue",
    tags: ["Stats"],
    summary: "Get revenue",
    description: "Returns the revenue stats for the protocol",
    operationId: "get_GetOverviewRevenue",
    request: {
      query: ChainIdQuery,
    },
    responses: {
      200: jsonResponse(
        "The revenue stats for the protocol",
        OverviewRevenueResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = c.req.valid("query").chainId ?? null;
    const queries = await createQueries(c.env);

    const [rawRevenueByTokenByDate, rawRevenueByToken_24h] = await Promise.all([
      queries.getRevenueByTokenByDate(chainId, thirtyDaysAgo),
      queries.getRevenueByToken({ since: twentyFourHoursAgo, chainId }),
    ]);

    const revenueByTokenByDate = rawRevenueByTokenByDate.map(
      normalizeRevenueByDateRow,
    );
    const revenueByToken_24h = rawRevenueByToken_24h.map((row) => ({
      token: toHex(row.token),
      revenue: row.revenue,
      chain_id: toHex(row.chain_id),
    }));

    const response = {
      revenueByToken_24h,
      revenueByTokenByDate,
    } satisfies z.infer<typeof OverviewRevenueResponseType>;

    return c.json(response, 200, {
      "cache-control": OVERVIEW_CACHE_CONTROL,
    });
  },
);

export const GetOverviewVolume = defineRoute(
  createRoute({
    method: "get",
    path: "/overview/volume",
    tags: ["Stats"],
    summary: "Get volume",
    description: "Returns the volume portion of the overview",
    operationId: "get_GetOverviewVolume",
    request: {
      query: ChainIdQuery,
    },
    responses: {
      200: jsonResponse(
        "The volume stats for the protocol",
        OverviewVolumeResponseType,
      ),
      ...errorResponses,
    },
  }),
  async (c) => {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = c.req.valid("query").chainId ?? null;
    const queries = await createQueries(c.env);

    const [rawVolumeByToken_24h, volumeByTokenByDate, pricedTokens] =
      await Promise.all([
        queries.getTotalVolume({
          chainId,
          since: twentyFourHoursAgo,
          minVolumeUsd: 1000,
        }),
        queries.getVolumeByTokenByDate(chainId, thirtyDaysAgo),
        queries.listPricedErc20Tokens(chainId),
      ]);

    const volumeByToken_24h = rawVolumeByToken_24h.map((row) =>
      normalizeVolumeRow(row as VolumeRow),
    );

    const priceUsd = createTokenPricer(pricedTokens);
    const totalsByChain = sumUsdByChain(
      VOLUME_TOTAL_FIELDS,
      volumeByToken_24h.map((row) => ({
        chain_id: row.chain_id,
        usd: {
          volumeUsd24h: priceUsd(row.chain_id, row.token, row.volume),
        },
      })),
    );

    const response = {
      volumeByTokenByDate: volumeByTokenByDate.map((vol) => ({
        ...vol,
        token: toHex(vol.token),
        chain_id: toHex(vol.chain_id),
      })),
      volumeByToken_24h: volumeByToken_24h.map((vol) => ({
        ...vol,
        chain_id: toHex(vol.chain_id),
        token: toHex(vol.token),
      })),
      totals: sumFields(VOLUME_TOTAL_FIELDS, totalsByChain),
      totalsByChain,
    } satisfies z.infer<typeof OverviewVolumeResponseType>;

    return c.json(response, 200, {
      "cache-control": OVERVIEW_CACHE_CONTROL,
    });
  },
);

export const GetOverviewTvl = defineRoute(
  createRoute({
    method: "get",
    path: "/overview/tvl",
    tags: ["Stats"],
    summary: "Get TVL",
    description: "Returns the TVL portion of the overview",
    operationId: "get_GetOverviewTvl",
    request: {
      query: ChainIdQuery,
    },
    responses: {
      200: jsonResponse("The TVL stats", OverviewTvlResponseType),
      ...errorResponses,
    },
  }),
  async (c) => {
    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainId = c.req.valid("query").chainId ?? null;
    const queries = await createQueries(c.env);

    const tvlDeltaDate = utcDateString(
      new Date(timestamp - 1000 * 60 * 60 * 24),
    );

    const [tvlByToken, rawTvlDeltaByTokenByDate, pricedTokens] =
      await Promise.all([
        queries.getTvlByToken(chainId),
        queries.getTvlDeltaByTokenByDate(chainId, thirtyDaysAgo),
        queries.listPricedErc20Tokens(chainId),
      ]);

    const tvlDeltaByTokenByDate = rawTvlDeltaByTokenByDate.map((row) =>
      normalizeTvlDeltaRow(row as TvlDeltaRow),
    );

    const priceUsd = createTokenPricer(pricedTokens);
    const totalsByChain = sumUsdByChain(TVL_TOTAL_FIELDS, [
      ...tvlByToken.map((row) => ({
        chain_id: row.chain_id.toString(),
        usd: {
          tvlUsd: priceUsd(row.chain_id.toString(), row.token, row.balance),
        },
      })),
      ...tvlDeltaByTokenByDate
        .filter((row) => utcDateString(row.date) === tvlDeltaDate)
        .map((row) => ({
          chain_id: row.chain_id,
          usd: {
            tvlDeltaUsdYesterday: priceUsd(row.chain_id, row.token, row.delta),
          },
        })),
    ]);

    const response = {
      tvlByToken: tvlByToken.map((tvl) => ({
        ...tvl,
        token: toHex(tvl.token),
        chain_id: toHex(tvl.chain_id),
      })),
      tvlDeltaByTokenByDate,
      totals: {
        ...sumFields(TVL_TOTAL_FIELDS, totalsByChain),
        tvlDeltaDate,
      },
      totalsByChain,
    } satisfies z.infer<typeof OverviewTvlResponseType>;

    return c.json(response, 200, {
      "cache-control": OVERVIEW_CACHE_CONTROL,
    });
  },
);
