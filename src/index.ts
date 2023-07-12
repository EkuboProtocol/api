import { createCors, error, IRequest, json, Router } from "itty-router";
import { NFTMetadata } from "./nft";
import { generateSvg } from "./generateSvg";
import { parseId } from "./parseId";
import { Env } from "./env";
import { ExecutionContext } from "@cloudflare/workers-types";

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
});

// create a convenient duple
type CF = [env: Env, context: ExecutionContext];

const router = Router<IRequest, CF>().all("*", preflight);

router
  .get<IRequest, CF>("/:id", async ({ url, params: { id: idStr } }, env) => {
    const id = parseId(idStr);
    if (id === null) {
      return error(404, "Invalid token ID");
    }

    const attributesStored = [];

    if (attributesStored === null) {
      return error(404, "Token metadata not found");
    }

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

      const attributesStored = [];

      if (attributesStored === null) {
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
  fetch: (request) =>
    router
      .handle(request)

      // transform unformed responses
      .then(json)

      // catch any errors
      .catch(error)

      // add CORS headers to all requests,
      // including errors
      .then(corsify),
};
