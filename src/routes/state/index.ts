import {
  OpenAPIRouteSchema,
  Path,
  Query,
} from "@cloudflare/itty-router-openapi";
import { IRequest, json } from "itty-router";
import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { createQueries } from "../../queries";
import {
  AddressType,
  ChainIdType,
  HexStringType,
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";
import toHex from "../../shared/toHex";

const LiquidityPointType = z.object({
  tick: z.string(),
  net_liquidity_delta_diff: z.string(),
});

const LiquiditySeriesType = z.array(LiquidityPointType);
const LiquidityResponseType = z.object({
  data: LiquiditySeriesType,
});

export class GetPoolLiquidity extends EkuboAPIRoute {
  static route =
    "/pools/:chainId/:coreAddress/:token0/:token1/:fee/:tickSpacing/:extension/liquidity";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      token0: Path(AddressType, {
        example: "0x0000000000000000000000000000000000000000",
      }),
      token1: Path(AddressType, {
        example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      }),
      fee: Path(NumericStringType, {
        example: "1020847100762815390390123822295304634",
      }),
      tickSpacing: Path(NumericStringType, { example: "5982" }),
      extension: Path(AddressType, { example: "0xabcd" }),
    },
    responses: {
      "200": {
        schema: LiquidityResponseType,
        description: "The current liquidity chart for the given pool key hash",
      },
    },
  };

  async handle(
    {
      params: {
        chainId,
        coreAddress,
        token0,
        token1,
        fee,
        tickSpacing,
        extension,
      },
    }: IRequest,
    { env }: RequestContext,
  ) {
    const queries = await createQueries(env);

    const rows = await queries.getPoolLiquidityGraph(BigInt(chainId), {
      coreAddress: BigInt(coreAddress),
      token0: BigInt(token0),
      token1: BigInt(token1),
      fee: BigInt(fee),
      tickSpacing: Number(tickSpacing),
      extension: BigInt(extension),
    });

    const response = {
      data: rows,
    } satisfies z.infer<typeof LiquidityResponseType>;

    return json(response, {
      headers: {
        "cache-control": "public, max-age=1800, must-revalidate",
      },
    });
  }
}
