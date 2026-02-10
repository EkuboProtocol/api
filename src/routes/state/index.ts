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
  NumericStringType,
} from "../../shared/validation/address";
import { z } from "zod";

const LiquidityPointType = z.object({
  tick: z.string(),
  net_liquidity_delta_diff: z.string(),
});

const LiquiditySeriesType = z.array(LiquidityPointType);
const LiquidityResponseType = z.object({
  data: LiquiditySeriesType,
});

export class GetPoolLiquidity extends EkuboAPIRoute {
  static route = "/pools/:chainId/:coreAddress/:poolId/liquidity";

  static schema: OpenAPIRouteSchema = {
    tags: ["Swap"],
    summary: "Get pool liquidity",
    description:
      "Returns the liquidity delta for each tick for the given pool key hash",
    parameters: {
      chainId: Path(ChainIdType, { required: true }),
      coreAddress: Path(AddressType, { example: "0xabcd" }),
      poolId: Path(NumericStringType, { example: "1" }),
    },
    responses: {
      "200": {
        schema: LiquidityResponseType,
        description: "The current liquidity chart for the given pool key hash",
      },
    },
  };

  async handle(
    { params: { chainId, coreAddress, poolId } }: IRequest,
    { env }: RequestContext,
  ) {
    const queries = await createQueries(env);

    const rows = await queries.getPoolLiquidityGraph(BigInt(chainId), {
      coreAddress: BigInt(coreAddress),
      poolId: BigInt(poolId),
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
