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
  token: row.token,
  volume: row.volume,
  fees: row.fees ?? "0",
  chain_id: row.chain_id.toString(),
});

type RevenueByDateRow = {
  token: string;
  chain_id: bigint;
} & Partial<{ date: string | Date; revenue: string; volume: string }>;

const normalizeRevenueByDateRow = (row: RevenueByDateRow) => ({
  token: row.token,
  date: row.date ?? new Date(0),
  revenue: row.revenue ?? row.volume ?? "0",
  chain_id: row.chain_id.toString(),
});

type TvlDeltaRow = {
  token: string;
  date: string | Date;
} & Partial<{ delta: string; balance: string }>;

const normalizeTvlDeltaRow = (row: TvlDeltaRow) => ({
  token: row.token,
  date: row.date,
  delta: row.delta ?? row.balance ?? "0",
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

const RevenueEntryType = z.object({
  token: z.string(),
  revenue: z.string(),
  chain_id: HexStringType,
});

const RevenueByDateEntryType = RevenueEntryType.extend({
  date: TimestampType,
});

const OverviewRevenueResponseType = z.object({
  revenueByToken: z.array(RevenueEntryType),
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
  volumeByToken: z.array(VolumeEntryType),
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
        contentType: "application/json",
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
        chain_id: tp.chain_id.toString(),
      })),
    } satisfies z.infer<typeof OverviewPairsResponseType>;

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
        contentType: "application/json",
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

    const [rawRevenueByToken, rawRevenueByTokenByDate, rawRevenueByToken_24h] =
      await Promise.all([
        queries.getRevenueByToken({ chainId }),
        queries.getRevenueByTokenByDate(chainId, thirtyDaysAgo),
        queries.getRevenueByToken({ since: twentyFourHoursAgo, chainId }),
      ]);

    const revenueByToken = rawRevenueByToken.map((row) => ({
      token: row.token,
      revenue: row.revenue,
      chain_id: row.chain_id.toString(),
    }));
    const revenueByTokenByDate = rawRevenueByTokenByDate.map(
      normalizeRevenueByDateRow,
    );
    const revenueByToken_24h = rawRevenueByToken_24h.map((row) => ({
      token: row.token,
      revenue: row.revenue,
      chain_id: row.chain_id.toString(),
    }));

    const response = {
      revenueByToken,
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
        contentType: "application/json",
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

    const [rawVolumeByToken, rawVolumeByToken_24h, volumeByTokenByDate] =
      await Promise.all([
        queries.getTotalVolume({ chainId }),
        queries.getTotalVolume({ chainId, since: twentyFourHoursAgo }),
        queries.getVolumeByTokenByDate(chainId, thirtyDaysAgo),
      ]);

    const volumeByToken = rawVolumeByToken.map((row) =>
      normalizeVolumeRow(row as VolumeRow),
    );
    const volumeByToken_24h = rawVolumeByToken_24h.map((row) =>
      normalizeVolumeRow(row as VolumeRow),
    );

    const response = {
      volumeByToken,
      volumeByTokenByDate: volumeByTokenByDate.map((vol) => ({
        ...vol,
        chain_id: toHex(vol.chain_id),
      })),
      volumeByToken_24h,
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
        contentType: "application/json",
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
        chain_id: tvl.chain_id.toString(),
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
