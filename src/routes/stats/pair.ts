import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json, StatusError } from "itty-router";
import {
  ChainIdType,
  NumericStringType,
  TokenIdentifierType,
} from "../../shared/validation/address";
import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { parseOutTokens } from "../../shared/parseOutTokens";
import { z } from "zod";
import toHex from "../../shared/toHex";

const TimestampType = z.union([z.date(), z.string()]);

const TokenBalanceEntryType = z.object({
  token: z.string(),
  balance: z.string(),
});

const TokenDeltaEntryType = z.object({
  token: z.string(),
  date: TimestampType,
  delta: z.string(),
});

const PairTvlResponseType = z.object({
  tvlByToken: z.array(TokenBalanceEntryType),
  tvlDeltaByTokenByDate: z.array(TokenDeltaEntryType),
});

type PairVolumeRow = {
  token: string;
  volume: string;
} & Partial<{ fees: string }>;

const normalizePairVolumeRow = (row: PairVolumeRow) => ({
  token: row.token,
  volume: row.volume,
  fees: row.fees ?? "0",
});

type PairTvlDeltaRow = {
  token: string;
  date: string | Date;
} & Partial<{ delta: string; balance: string }>;

const normalizePairTvlDeltaRow = (row: PairTvlDeltaRow) => ({
  token: row.token,
  date: row.date,
  delta: row.delta ?? row.balance ?? "0",
});

const VolumeEntryType = z.object({
  token: z.string(),
  volume: z.string(),
  fees: z.string(),
});

const VolumeByDateEntryType = VolumeEntryType.extend({
  date: TimestampType,
});

const PairVolumeResponseType = z.object({
  chain_id: z.string(),
  volumeByToken: z.array(VolumeEntryType),
  volumeByTokenByDate: z.array(VolumeByDateEntryType),
  volumeByToken_24h: z.array(VolumeEntryType),
});

const PoolStatsType = z.object({
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
});

const PairPoolsResponseType = z.object({
  topPools: z.array(PoolStatsType),
});

const LiquidityPointType = z.object({
  tick: z.string(),
  net_liquidity_delta_diff: z.string(),
});

const PairLiquidityResponseType = z.object({
  data: z.array(LiquidityPointType),
});

const PairEventType = z.object({
  type: z.union([z.literal(0), z.literal(1)]),
  fee: z.string(),
  tick_spacing: z.number().int(),
  extension: z.string(),
  core_address: z.string(),
  locker: z.string(),
  timestamp: TimestampType,
  transaction_hash: z.string(),
  delta0: z.string(),
  delta1: z.string(),
});

const PairEventsResponseType = z.object({
  data: z.array(PairEventType),
});

export class GetPairInfoTvl extends EkuboAPIRoute {
  static route = "/pair/:chainId/:tokenA/:tokenB/tvl";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair TVL",
    description: "Returns TVL stats for the pair",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the token pair TVL",
        contentType: "application/json",
        schema: PairTvlResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const { queries, pair } = await parseOutTokens(
      env,
      request.params,
      chainId,
    );

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [tvlByToken, rawTvlDeltaByTokenByDate] = await Promise.all([
      queries.getTvlByToken(chainId, pair),
      queries.getTvlDeltaByTokenByDate(chainId, thirtyDaysAgo, pair),
    ]);

    const tvlDeltaByTokenByDate = rawTvlDeltaByTokenByDate.map((row) =>
      normalizePairTvlDeltaRow(row as PairTvlDeltaRow),
    );

    const response = {
      tvlByToken: tvlByToken.map((tvl) => ({
        ...tvl,
        chain_id: toHex(tvl.chain_id),
      })),
      tvlDeltaByTokenByDate,
    } satisfies z.infer<typeof PairTvlResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=3600",
      },
    });
  }
}

export class GetPairInfoVolume extends EkuboAPIRoute {
  static route = "/pair/:chainId/:tokenA/:tokenB/volume";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair volume",
    description: "Returns volume stats for a given trading pair",
    parameters: {
      chainId: Path(NumericStringType),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "Information about the token pair volume",
        contentType: "application/json",
        schema: PairVolumeResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const { queries, pair } = await parseOutTokens(
      env,
      request.params,
      chainId,
    );

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);

    const [rawVolumeByToken, rawVolumeByToken_24h, volumeByTokenByDate] =
      await Promise.all([
        queries.getTotalVolume({ pair, chainId }),
        queries.getTotalVolume({
          chainId,
          since: twentyFourHoursAgo,
          pair,
        }),
        queries.getVolumeByTokenByDate(chainId, thirtyDaysAgo, pair),
      ]);

    const volumeByToken = rawVolumeByToken.map((row) =>
      normalizePairVolumeRow(row as PairVolumeRow),
    );
    const volumeByToken_24h = rawVolumeByToken_24h.map((row) =>
      normalizePairVolumeRow(row as PairVolumeRow),
    );

    const response = {
      chain_id: toHex(chainId),
      volumeByToken,
      volumeByTokenByDate: volumeByTokenByDate.map((vol) => ({
        ...vol,
        chain_id: toHex(vol.chain_id),
      })),
      volumeByToken_24h,
    } satisfies z.infer<typeof PairVolumeResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

const MinTvlQueryParameter = z.coerce.number().min(0).default(1_000);

export class GetPairInfoPools extends EkuboAPIRoute {
  static route = "/pair/:chainId/:tokenA/:tokenB/pools";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pools of pair",
    description: "Returns pool info for a pair",
    parameters: {
      chainId: Path(NumericStringType),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
      minTvlUsd: Query(MinTvlQueryParameter, {
        required: false,
        description: "Minimum USD TVL required for a pool to be included",
      }),
    },
    responses: {
      "200": {
        description: "Information about the pools of a token pair",
        contentType: "application/json",
        schema: PairPoolsResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const { queries, pair } = await parseOutTokens(
      env,
      request.params,
      chainId,
    );
    const minTvlUsd = MinTvlQueryParameter.parse(request.query?.minTvlUsd);

    const topPools = await queries.getTopPools(chainId, pair, minTvlUsd);

    const response = {
      topPools,
    } satisfies z.infer<typeof PairPoolsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600",
      },
    });
  }
}

export class GetPairLiquidity extends EkuboAPIRoute {
  static route = "/tokens/:chainId/:tokenA/:tokenB/liquidity";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair liquidity",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    description:
      "Returns the liquidity chart for the given token pair, aggregated across all pools",
    responses: {
      "200": {
        description: "For each tick for pools of the pair, the liquidity delta",
        contentType: "application/json",
        schema: PairLiquidityResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const { queries, pair } = await parseOutTokens(
      env,
      request.params,
      chainId,
    );

    const data = await queries.getPairLiquidityGraph({
      ...pair,
      chainId,
    });

    const response = {
      data,
    } satisfies z.infer<typeof PairLiquidityResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=600, must-revalidate",
      },
    });
  }
}

export class ListPairEvents extends EkuboAPIRoute {
  static route = "/tokens/:chainId/:tokenA/:tokenB/events";
  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get pair events",
    description: "Returns a list of recent events for the given trading pair",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
    },
    responses: {
      "200": {
        description: "A list of events for the given pair",
        contentType: "application/json",
        schema: PairEventsResponseType,
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    const chainId = BigInt(request.params.chainId);
    const { queries, pair } = await parseOutTokens(
      env,
      request.params,
      chainId,
    );

    const rows = await queries.getPairEvents({
      ...pair,
      limit: 100,
      chainId,
    });

    const response = {
      data: rows,
    } satisfies z.infer<typeof PairEventsResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=180, must-revalidate",
      },
    });
  }
}
