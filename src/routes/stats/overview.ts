import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import { OpenAPIRouteSchema, Query } from "@cloudflare/itty-router-openapi";
import { ChainIdType, HexStringType } from "../../shared/validation/address";
import { z } from "zod";
import toHex from "../../shared/toHex";

const TimestampType = z.union([z.date(), z.string()]);
const TokenIdentifierSchema = z.union([z.string(), z.number()]);

type VolumeRow = { token: string; volume: string; chain_id: bigint } & Partial<{
  fees: string;
}>;
const normalizeVolumeRow = (row: VolumeRow) => ({
  token: toHex(row.token),
  volume: row.volume,
  fees: row.fees ?? "0",
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
  tick_spacing: z.number().int(),
  core_address: z.string(),
  extension: z.string(),
  volume0_24h: z.string(),
  volume1_24h: z.string(),
  fees0_24h: z.string(),
  fees1_24h: z.string(),
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
  chain_id: HexStringType,
});

const VolumeByDateEntryType = VolumeEntryType.extend({
  date: TimestampType,
});

const OverviewVolumeResponseType = z.object({
  volumeByTokenByDate: z.array(VolumeByDateEntryType),
  volumeByToken_24h: z.array(VolumeEntryType),
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

const OverviewTvlResponseType = z.object({
  tvlByToken: z.array(TvlEntryType),
  tvlDeltaByTokenByDate: z.array(TvlDeltaEntryType),
});

const MinTvlQueryParameter = z.coerce.number().min(0).default(1_000);

export class GetOverviewPairs extends EkuboAPIRoute {
  static route = "/overview/pairs";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pairs",
    description: "Returns stats for the top pairs",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
      minTvlUsd: Query(MinTvlQueryParameter, {
        required: false,
        description: "Minimum USD TVL required for a pair to be included",
      }),
    },
    responses: {
      "200": {
        description: "The stats for the protocols top pairs",
        schema: OverviewPairsResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainIdParam = request.query?.chainId;
    const chainId =
      chainIdParam !== undefined ? ChainIdType.parse(chainIdParam) : null;
    const queries = await createQueries(env);
    const minTvlUsd = MinTvlQueryParameter.parse(request.query?.minTvlUsd);

    const topPairs = await queries.getTopPairs(chainId, minTvlUsd);

    const response = {
      topPairs: topPairs.map((tp) => ({
        ...tp,
        token0: toHex(tp.token0),
        token1: toHex(tp.token1),
        chain_id: toHex(tp.chain_id),
      })),
    } satisfies z.infer<typeof OverviewPairsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

export class GetOverviewBoostedFeesPools extends EkuboAPIRoute {
  static route = "/overview/boosted-fees-pools";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get boosted fees pools",
    description:
      "Returns pools with boosted fees state, including current and scheduled donation deltas",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
    },
    responses: {
      "200": {
        description: "Pools with boosted fees data",
        schema: OverviewBoostedFeesPoolsResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainIdParam = request.query?.chainId;
    const chainId =
      chainIdParam !== undefined ? ChainIdType.parse(chainIdParam) : null;
    const queries = await createQueries(env);

    const pools = await queries.getBoostedFeesPools(chainId);

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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

export class GetOverviewRevenue extends EkuboAPIRoute {
  static route = "/overview/revenue";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get revenue",
    description: "Returns the revenue stats for the protocol",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
    },
    responses: {
      "200": {
        description: "The revenue stats for the protocol",
        schema: OverviewRevenueResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainIdParam = request.query?.chainId;
    const chainId =
      chainIdParam !== undefined ? ChainIdType.parse(chainIdParam) : null;
    const queries = await createQueries(env);

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

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

export class GetOverviewVolume extends EkuboAPIRoute {
  static route = "/overview/volume";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get volume",
    description: "Returns the volume portion of the overview",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
    },
    responses: {
      "200": {
        description: "The volume stats for the protocol",
        schema: OverviewVolumeResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainIdParam = request.query?.chainId;
    const chainId =
      chainIdParam !== undefined ? ChainIdType.parse(chainIdParam) : null;
    const queries = await createQueries(env);

    const [rawVolumeByToken_24h, volumeByTokenByDate] = await Promise.all([
      queries.getTotalVolume({
        chainId,
        since: twentyFourHoursAgo,
        minVolumeUsd: 1000,
      }),
      queries.getVolumeByTokenByDate(chainId, thirtyDaysAgo),
    ]);

    const volumeByToken_24h = rawVolumeByToken_24h.map((row) =>
      normalizeVolumeRow(row as VolumeRow),
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
    } satisfies z.infer<typeof OverviewVolumeResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

export class GetOverviewTvl extends EkuboAPIRoute {
  static route = "/overview/tvl";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get TVL",
    description: "Returns the TVL portion of the overview",
    parameters: {
      chainId: Query(ChainIdType, { required: false }),
    },
    responses: {
      "200": {
        description: "The TVL stats",
        schema: OverviewTvlResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const chainIdParam = request.query?.chainId;
    const chainId =
      chainIdParam !== undefined ? ChainIdType.parse(chainIdParam) : null;
    const queries = await createQueries(env);

    const [tvlByToken, rawTvlDeltaByTokenByDate] = await Promise.all([
      queries.getTvlByToken(chainId),
      queries.getTvlDeltaByTokenByDate(chainId, thirtyDaysAgo),
    ]);

    const tvlDeltaByTokenByDate = rawTvlDeltaByTokenByDate.map((row) =>
      normalizeTvlDeltaRow(row as TvlDeltaRow),
    );

    const response = {
      tvlByToken: tvlByToken.map((tvl) => ({
        ...tvl,
        token: toHex(tvl.token),
        chain_id: toHex(tvl.chain_id),
      })),
      tvlDeltaByTokenByDate,
    } satisfies z.infer<typeof OverviewTvlResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}
