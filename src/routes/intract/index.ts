import { EkuboAPIRoute, RequestContext } from "../../shared/context";
import { OpenAPIRouteSchema, Path } from "@cloudflare/itty-router-openapi";
import { z } from "zod";
import { IRequest, json } from "itty-router";
import { createQueries } from "../../queries";
import { AddressType, NumericType } from "../../shared/validation/address";
import { getAllTokens, getTokenByIdentifier } from "../meta/tokens";

enum IntractQuests {
  SWAP_FROM_ETH_TO_STRK = 1,
  SWAP_FROM_USDC_OR_USDT_TO_STRK = 2,
  SWAP_FROM_USDC_OR_USDT_TO_ETH = 3,
  ADD_LIQUIDITY_TO_STRK_ETH = 4,
  ADD_LIQUIDITY_TO_STRK_USDC = 5,
  ADD_LIQUIDITY_TO_ETH_USDC = 6,
  ADD_LIQUIDITY_TO_USDC_USDT = 7,
}

export class IntractApiRoute extends EkuboAPIRoute {
  static route = "/intract/:questId";
  static schema: OpenAPIRouteSchema = {
    tags: ["Quest"],
    summary: "Intract quest verification endpoint",
    description:
      "Get whether the given Intract quest ID has been completed for the specified address",
    request: {
      body: {
        description: "The address being queried for the quest status",
        required: true,
        content: {
          "application/json": {
            schema: z.object({
              address: AddressType,
            }),
            example: { address: "0xabcd" },
          },
        },
      },
    },
    parameters: {
      questId: Path(NumericType, {
        example: 1,
      }),
    },

    responses: {
      "200": {
        description: "The Intract response",
        schema: z
          .object({
            error: z
              .object({
                code: z.number().int().optional(),
                message: z.string().optional(),
              })
              .optional(),
            data: z.object({ result: z.boolean() }).required(),
          })
          .openapi({ description: "Intract standard response format" }),
        contentType: "application/json",
      },
    },
  };

  async handle(request: IRequest, { env }: RequestContext) {
    let result = false;

    const { address: addressStr } = (await request.json()) as {
      address: string;
    };

    let address: bigint;
    try {
      address = BigInt(addressStr);
    } catch (e) {
      return json({
        error: {
          code: 400,
          message: "Invalid address",
        },
      });
    }

    const queries = await createQueries(env);

    const tokens = await getAllTokens(env, queries);

    switch (parseInt(request.params.questId)) {
      case IntractQuests.SWAP_FROM_ETH_TO_STRK: {
        const [eth, strk] = [
          getTokenByIdentifier(tokens, "ETH"),
          getTokenByIdentifier(tokens, "STRK"),
        ];
        if (eth && strk) {
          result = await queries.hasSwapped({
            address,
            fromToken: BigInt(eth.l2_token_address),
            toToken: BigInt(strk.l2_token_address),
          });
        }
        break;
      }

      case IntractQuests.SWAP_FROM_USDC_OR_USDT_TO_STRK: {
        const [usdc, usdt, strk] = [
          getTokenByIdentifier(tokens, "USDC"),
          getTokenByIdentifier(tokens, "USDT"),
          getTokenByIdentifier(tokens, "STRK"),
        ];

        if (usdc && strk) {
          result = await queries.hasSwapped({
            address,
            fromToken: BigInt(usdc.l2_token_address),
            toToken: BigInt(strk.l2_token_address),
            minAmount: 10n * 10n ** BigInt(usdc.decimals),
          });
        }

        if (usdt && strk && !result) {
          result = await queries.hasSwapped({
            address,
            fromToken: BigInt(usdt.l2_token_address),
            toToken: BigInt(strk.l2_token_address),
            minAmount: 10n * 10n ** BigInt(usdt.decimals),
          });
        }
        break;
      }

      case IntractQuests.SWAP_FROM_USDC_OR_USDT_TO_ETH: {
        const [usdc, usdt, eth] = [
          getTokenByIdentifier(tokens, "USDC"),
          getTokenByIdentifier(tokens, "USDT"),
          getTokenByIdentifier(tokens, "ETH"),
        ];

        if (usdc && eth) {
          result = await queries.hasSwapped({
            address,
            fromToken: BigInt(usdc.l2_token_address),
            toToken: BigInt(eth.l2_token_address),
            minAmount: 10n * 10n ** BigInt(usdc.decimals),
          });
        }

        if (usdt && eth && !result) {
          result = await queries.hasSwapped({
            address,
            fromToken: BigInt(usdt.l2_token_address),
            toToken: BigInt(eth.l2_token_address),
            minAmount: 10n * 10n ** BigInt(usdt.decimals),
          });
        }
        break;
      }

      case IntractQuests.ADD_LIQUIDITY_TO_ETH_USDC: {
        const [usdc, eth] = [
          getTokenByIdentifier(tokens, "USDC"),
          getTokenByIdentifier(tokens, "ETH"),
        ];

        if (usdc && eth) {
          result = await queries.hasAddedLiquidity({
            address,
            tokenA: BigInt(usdc.l2_token_address),
            tokenB: BigInt(eth.l2_token_address),
          });
        }
        break;
      }

      case IntractQuests.ADD_LIQUIDITY_TO_STRK_ETH: {
        const [strk, eth] = [
          getTokenByIdentifier(tokens, "STRK"),
          getTokenByIdentifier(tokens, "ETH"),
        ];

        if (strk && eth) {
          result = await queries.hasAddedLiquidity({
            address,
            tokenA: BigInt(strk.l2_token_address),
            tokenB: BigInt(eth.l2_token_address),
          });
        }
        break;
      }
      case IntractQuests.ADD_LIQUIDITY_TO_STRK_USDC: {
        const [usdt, usdc] = [
          getTokenByIdentifier(tokens, "STRK"),
          getTokenByIdentifier(tokens, "USDC"),
        ];

        if (usdt && usdc) {
          result = await queries.hasAddedLiquidity({
            address,
            tokenA: BigInt(usdt.l2_token_address),
            tokenB: BigInt(usdc.l2_token_address),
          });
        }
        break;
      }

      case IntractQuests.ADD_LIQUIDITY_TO_USDC_USDT: {
        const [usdt, usdc] = [
          getTokenByIdentifier(tokens, "USDT"),
          getTokenByIdentifier(tokens, "USDC"),
        ];

        if (usdt && usdc) {
          result = await queries.hasAddedLiquidity({
            address,
            tokenA: BigInt(usdt.l2_token_address),
            tokenB: BigInt(usdc.l2_token_address),
          });
        }
        break;
      }

      default:
        return json({
          error: {
            code: 404,
            message: "Invalid quest ID",
          },
        });
    }

    return json({
      data: { result },
    });
  }
}
