import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { ExecutionContext } from "@cloudflare/workers-types";
import { createConnectedClient } from "./createConnectedClient";

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
  .get<IRequest, CF>("/:id", async ({ url, params: { id: idStr } }, env) => {
    const id = parseId(idStr);
    if (id === null) {
      return error(404, "Invalid token ID");
    }

    const client = await createConnectedClient(env);

    const { rows, rowCount } = await client.query(`
        SELECT position_metadata.lower_bound, position_metadata.upper_bound, 
               pool_keys.token0, pool_keys.token1, pool_keys.fee, pool_keys.tick_spacing, pool_keys.extension
        FROM position_metadata
        JOIN pool_keys on position_metadata.pool_key_hash = pool_keys.key_hash WHERE token_id = ${id}
    `);

    if (rowCount !== 1) {
      return error(404, "Token metadata not found");
    }

    const [rowData] = rows;

    const attributesStored: NFTMetadata["attributes"] = [
      { trait_type: "token0", value: numericToHex(rowData.token0) },
      { trait_type: "token1", value: numericToHex(rowData.token1) },
      { trait_type: "fee", value: rowData.fee.toString() },
      { trait_type: "tick_spacing", value: rowData.tick_spacing.toString() },
      {
        trait_type: "extension",
        value: numericToHex(rowData.extension).toString(),
      },
      { trait_type: "tick_lower", value: rowData.lower_bound.toString() },
      { trait_type: "tick_upper", value: rowData.upper_bound.toString() },
    ];

    const origin = new URL(url).origin;

    const metadata: NFTMetadata = {
      name: `Ekubo NFT #${id}`,
      description: "An NFT that represents a liquidity position in Ekubo",
      image: `${origin}/${id}/image.svg`,
      attributes: attributesStored,
    };

    return metadata;
  })
  .get<IRequest, CF>(
    "/:id/image.svg",
    async ({ params: { id: idStr } }, env) => {
      const id = parseId(idStr);
      if (id === null) {
        return error(404, "Invalid token ID");
      }

      const client = await createConnectedClient(env);

      const { rowCount } = await client.query(`
        SELECT token_id FROM position_metadata WHERE token_id = ${id}
      `);

      if (rowCount !== 1) {
        return error(404, "Token metadata not found");
      }

      return new Response(generateSvg(id, env.STARKNET_CHAIN_ID), {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
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
