import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { IRequest, json } from "itty-router";
import {
  AddressType,
  ChainIdType,
  DecimalStringType,
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
  chain_id: z.string(),
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
  volumeByTokenByDate: z.array(VolumeByDateEntryType),
  volumeByToken_24h: z.array(VolumeEntryType),
});

const PoolStatsType = z.object({
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
  boosts: z
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
    .nullable(),
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

const PairTopPositionsEntryType = z.object({
  id: z.string(),
  chain_id: z.string(),
  nft_address: z.string(),
  core_address: z.string(),
  positions_address: z.string(),
  owner: AddressType,
  minted_timestamp: TimestampType,
  pool_key: z.object({
    token0: z.string(),
    token1: z.string(),
    fee: z.string(),
    tick_spacing: z.string().nullable(),
    extension: z.string(),
    stableswap_params: z
      .object({ center_tick: z.number(), amplification: z.number() })
      .nullable(),
  }),
  bounds: z.object({
    lower: z.number(),
    upper: z.number(),
  }),
  liquidity: z.string(),
  pool_state: z
    .object({
      sqrt_ratio: DecimalStringType,
      tick: z.number().int(),
      liquidity: DecimalStringType,
    })
    .nullable(),
});

const PairTopPositionsResponseType = z.object({
  data: z.array(PairTopPositionsEntryType),
});

const PoolFilterQueryParameters = {
  coreAddress: Query(AddressType, {
    required: false,
    description: "Restrict results to pools with the given core address.",
  }),
  poolId: Query(NumericStringType, {
    required: false,
    description: "Restrict results to pools with the given pool id.",
  }),
};

type PoolKeyFilters = {
  coreAddress?: bigint;
  poolId?: bigint;
};

const parsePoolKeyFilters = (request: IRequest): PoolKeyFilters => {
  const hasCoreAddress = request.query?.coreAddress !== undefined;
  const hasPoolId = request.query?.poolId !== undefined;

  return {
    coreAddress: hasCoreAddress
      ? BigInt(AddressType.parse(request.query?.coreAddress))
      : undefined,
    poolId: hasPoolId
      ? BigInt(NumericStringType.parse(request.query?.poolId))
      : undefined,
  };
};

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
      ...PoolFilterQueryParameters,
    },
    responses: {
      "200": {
        description: "Information about the token pair TVL",
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
    const poolKeyFilters = parsePoolKeyFilters(request);

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);

    const [tvlByToken, rawTvlDeltaByTokenByDate] = await Promise.all([
      queries.getTvlByToken(chainId, pair, poolKeyFilters),
      queries.getTvlDeltaByTokenByDate(
        chainId,
        thirtyDaysAgo,
        pair,
        poolKeyFilters,
      ),
    ]);

    const tvlDeltaByTokenByDate = rawTvlDeltaByTokenByDate.map((row) => ({
      token: row.token,
      date: row.date,
      delta: row.delta ?? "0",
      chain_id: toHex(row.chain_id),
    }));

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
      ...PoolFilterQueryParameters,
    },
    responses: {
      "200": {
        description: "Information about the token pair volume",
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

    const poolKeyFilters = parsePoolKeyFilters(request);

    const timestamp = Date.now();
    const thirtyDaysAgo = new Date(timestamp - 1000 * 60 * 60 * 24 * 30);
    const twentyFourHoursAgo = new Date(timestamp - 1000 * 60 * 60 * 24);

    const [rawVolumeByToken_24h, volumeByTokenByDate] = await Promise.all([
      queries.getTotalVolume({
        chainId,
        since: twentyFourHoursAgo,
        pair,
        poolKeyFilters,
      }),
      queries.getVolumeByTokenByDate(
        chainId,
        thirtyDaysAgo,
        pair,
        undefined,
        poolKeyFilters,
      ),
    ]);

    const volumeByToken_24h = rawVolumeByToken_24h.map((row) =>
      normalizePairVolumeRow(row as PairVolumeRow),
    );

    const response = {
      chain_id: toHex(chainId),
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
      topPools: topPools.map((pool) => {
        const {
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
      ...PoolFilterQueryParameters,
    },
    responses: {
      "200": {
        description: "A list of events for the given pair",
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
    const poolKeyFilters = parsePoolKeyFilters(request);

    const rows = await queries.getPairEvents({
      ...pair,
      limit: 100,
      chainId,
      poolKeyFilters,
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

export class GetPairTopPositions extends EkuboAPIRoute {
  static route = "/pair/:chainId/:tokenA/:tokenB/positions";

  static schema: OpenAPIRouteSchema = {
    tags: ["Stats"],
    summary: "Get top positions for pair",
    description:
      "Returns the top positions (by liquidity) for the given trading pair",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      tokenA: Path(TokenIdentifierType),
      tokenB: Path(TokenIdentifierType),
      ...PoolFilterQueryParameters,
    },
    responses: {
      "200": {
        description: "Top positions for the given pair",
        schema: PairTopPositionsResponseType,
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
    const poolKeyFilters = parsePoolKeyFilters(request);

    const rows = await queries.getTopPositionsByPair({
      chainId,
      pair,
      poolKeyFilters,
      limit: 10,
    });

    const response = {
      data: rows.map((row) => {
        const stableswap_params =
          row.stableswap_amplification !== null &&
          row.stableswap_center_tick !== null
            ? {
                center_tick: Number(row.stableswap_center_tick),
                amplification: Number(row.stableswap_amplification),
              }
            : null;
        return {
          id: toHex(BigInt(row.token_id)),
          chain_id: toHex(row.chain_id),
          nft_address: toHex(row.nft_address),
          core_address: toHex(row.core_address),
          positions_address: toHex(row.positions_address),
          owner: toHex(row.owner),
          minted_timestamp: row.minted_timestamp,
          pool_key: {
            token0: toHex(row.token0),
            token1: toHex(row.token1),
            fee: toHex(row.fee),
            tick_spacing: row.tick_spacing ? toHex(row.tick_spacing) : null,
            extension: toHex(row.extension),
            stableswap_params,
          },
          bounds: {
            lower: Number(row.lower_bound),
            upper: Number(row.upper_bound),
          },
          liquidity: row.liquidity,
          pool_state:
            row.pool_state_sqrt_ratio === null ||
            row.pool_state_tick === null ||
            row.pool_state_liquidity === null
              ? null
              : {
                  sqrt_ratio: row.pool_state_sqrt_ratio,
                  tick: Number(row.pool_state_tick),
                  liquidity: row.pool_state_liquidity,
                },
        };
      }),
    } satisfies z.infer<typeof PairTopPositionsResponseType>;

    return json(response, {
      headers: {},
    });
  }
}
