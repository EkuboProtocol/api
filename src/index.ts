import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { ExecutionContext } from "@cloudflare/workers-types";
import { createQueries } from "./createQueries";

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
});

// create a convenient duple
type CF = [env: Env, context: ExecutionContext];

const router = Router<IRequest, CF>().all("*", preflight);

function numericToHex(x: bigint | number | string) {
  return `0x${BigInt(x).toString(16)}`;
}

router
  .get<IRequest, CF>("/overview", async ({}, env) => {
    const queries = await createQueries(env);

    const [{ rows: tvlByToken }, { rows: volumeByToken }] = await Promise.all([
      queries.getTvlByToken(),
      queries.getVolumeByToken(),
    ]);

    return json(
      {
        tvlByToken,
        volumeByToken,
      },
      {
        headers: {
          "cache-control": "public, max-age=600",
        },
      }
    );
  })
  .get<IRequest, CF>(
    "/pool/:key_hash/liquidity",
    async ({ params: { key_hash } }, env) => {
      let pool_key_hash: bigint;
      try {
        pool_key_hash = BigInt(key_hash);
      } catch (e) {
        return error(404, "Invalid pool key hash");
      }

      const client = await createQueries(env);

      const { rows } = await client.getPoolLiquidityGraph(pool_key_hash);

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=600",
          },
        }
      );
    }
  )
  .get<IRequest, CF>(
    "/tokens/:tokenA/:tokenB/liquidity",
    async ({ params: { tokenA: tokenAStr, tokenB: tokenBStr } }, env) => {
      let tokenA: bigint, tokenB: bigint;
      try {
        tokenA = BigInt(tokenAStr);
        tokenB = BigInt(tokenBStr);
      } catch (e) {
        return error(404, "Invalid tokens");
      }

      const client = await createQueries(env);

      const [token0, token1] =
        tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

      if (token0 === 0n) {
        return error(400, "Invalid tokens");
      }

      const { rows } = await client.getPairLiquidityGraph({
        token0: tokenA,
        token1: tokenB,
      });

      return json(
        {
          data: rows,
        },
        {
          headers: {
            "cache-control": "public, max-age=600",
          },
        }
      );
    }
  )
  .get<IRequest, CF>("/:id", async ({ url, params: { id: idStr } }, env) => {
    const id = parseId(idStr);
    if (id === null) {
      return error(404, "Invalid token ID");
    }

    const queries = await createQueries(env);

    const positionMetadata = await queries.getTokenMetadata(id);

    const attributesStored: NFTMetadata["attributes"] = [
      { trait_type: "token0", value: numericToHex(positionMetadata.token0) },
      { trait_type: "token1", value: numericToHex(positionMetadata.token1) },
      { trait_type: "fee", value: positionMetadata.fee.toString() },
      {
        trait_type: "tick_spacing",
        value: positionMetadata.tick_spacing.toString(),
      },
      {
        trait_type: "extension",
        value: numericToHex(positionMetadata.extension).toString(),
      },
      {
        trait_type: "tick_lower",
        value: positionMetadata.lower_bound.toString(),
      },
      {
        trait_type: "tick_upper",
        value: positionMetadata.upper_bound.toString(),
      },
    ];

    const origin = new URL(url).origin;

    const metadata: NFTMetadata = {
      name: `Ekubo NFT #${id}`,
      description: "An NFT that represents a liquidity position in Ekubo",
      image: `${origin}/${id}/image.svg`,
      attributes: attributesStored,
    };

    return json(metadata, {
      headers: {
        "cache-control": "public, max-age=3600",
      },
    });
  })
  .get<IRequest, CF>(
    "/:id/image.svg",
    async ({ params: { id: idStr } }, env) => {
      const id = parseId(idStr);
      if (id === null) {
        return error(404, "Invalid token ID");
      }

      const queries = await createQueries(env);

      const positionMetadata = await queries.getTokenMetadata(id);

      if (positionMetadata === null) {
        return error(404, "Token metadata not found");
      }

      return new Response(generateSvg(id, env.STARKNET_CHAIN_ID), {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }
  )
  // catch missed routes
  .all("*", () => error(404));

export default {
  fetch: (request, env, ctxt) =>
    router
      .handle(request, env, ctxt)

      // transform unformed responses
      .then(json)

      // catch any errors
      .catch(error)

      // add CORS headers to all requests,
      // including errors
      .then(corsify),
};
