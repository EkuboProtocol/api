import prand, { unsafeUniformIntDistribution } from "pure-rand";
import { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  PositionsMetadata: KVNamespace;

  STARKNET_CHAIN_ID:
    | "0x534e5f474f45524c49"
    | "0x534e5f474f45524c4932"
    | "0x534e5f4d41494e";
}

interface NFTMetadata {
  name: string;

  description: string;

  image: string;

  attributes: {
    trait_type: string;
    value: string;
  }[];
}

const NFT_METADATA_PATH = /^\/(\d+)$/;
const NFT_IMAGE_PATH = /^\/(\d+)\/image.svg$/;

function generateSvg(id: number, chainId: Env["STARKNET_CHAIN_ID"]): string {
  let generator = prand.xoroshiro128plus(Number(chainId));
  generator = prand.xoroshiro128plus(
    id + unsafeUniformIntDistribution(0, 2 ** 32 - id, generator)
  );

  const randomColor = () =>
    `#${unsafeUniformIntDistribution(0, 16777215, generator)
      .toString(16)
      .padStart(6, "0")}`;

  const randomIn = (min: number, max: number) =>
    unsafeUniformIntDistribution(min, max, generator);

  // Generate random parameters
  const circleRadius = randomIn(50, 100);
  const stopColor1 = randomColor();
  const stopColor2 = randomColor();
  const rect1X = randomIn(10, 40);
  const rectWidth = randomIn(40, 70);
  const rotateAngle = randomIn(0, 360);

  return `
    <svg width="134" height="134" viewBox="0 0 134 134" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="67" cy="67" r="${circleRadius}" fill="url(#paint0_linear_1_30)"/>
        <path fill-rule="evenodd" clip-rule="evenodd"
            transform="rotate(${rotateAngle}, 67, 67)"
            d="M${rect1X} 54.0769C${rect1X} 47.9593 ${rect1X + rectWidth} 43 ${
    rect1X + rectWidth
  } 43H92.9C99.0304 43 104 47.9593 104 54.0769V79.9231C104 86.0407 99.0304 91 92.9 91H41.1C34.9696 91 30 86.0407 30 79.9231V54.0769ZM67 67C67 75.1568 60.3738 81.7692 52.2 81.7692C44.0262 81.7692 37.4 75.1568 37.4 67C37.4 58.8432 44.0262 52.2308 52.2 52.2308C60.3738 52.2308 67 58.8432 67 67ZM67 67C67 58.8432 73.6262 52.2308 81.8 52.2308C89.9738 52.2308 96.6 58.8432 96.6 67C96.6 75.1568 89.9738 81.7692 81.8 81.7692C73.6262 81.7692 67 75.1568 67 67Z"
            fill="#F1F0FA"/>
        <defs>
            <linearGradient id="paint0_linear_1_30" x1="0" y1="0" x2="134" y2="134" gradientUnits="userSpaceOnUse">
                <stop stop-color="${stopColor1}"/>
                <stop offset="1" stop-color="${stopColor2}"/>
            </linearGradient>
        </defs>
    </svg>
    `;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
};

function errorResponse(code: number, message: string, retryable: boolean) {
  return new Response(JSON.stringify({ error: message }), {
    status: code,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json",
      "cache-control": `public, max-age=${
        retryable ? 30 : 86400
      }, must-revalidate`,
    },
  });
}

const MAX_ID = 10 ** 10 - 1;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "access-control-allow-headers":
            request.headers.get("access-control-request-headers") ?? "",
        },
      });
    }

    if (request.method !== "GET") {
      return errorResponse(405, "Method not allowed", false);
    }

    const url = new URL(request.url);

    const path = url.pathname;

    if (NFT_METADATA_PATH.test(path)) {
      const [, id] = NFT_METADATA_PATH.exec(path)!;

      if (Number(id) > MAX_ID) {
        return errorResponse(404, "Not found", false);
      }

      const attributesStored = await env.PositionsMetadata.get(
        BigInt(id).toString()
      );

      if (attributesStored === null) {
        return errorResponse(404, "Token metadata not found", true);
      }

      const attributes: NFTMetadata["attributes"] =
        JSON.parse(attributesStored);

      const metadata: NFTMetadata = {
        name: `Ekubo NFT #${id}`,
        description: "An NFT that represents a liquidity position in Ekubo",
        image: `${url.origin}/${id}/image.svg`,
        attributes,
      };
      return new Response(JSON.stringify(metadata), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "content-type": "application/json",
          "cache-control": "public, max-age=60, must-revalidate",
        },
      });
    } else if (NFT_IMAGE_PATH.test(path)) {
      let [, id] = NFT_IMAGE_PATH.exec(path)!;

      if (Number(id) > MAX_ID) {
        return errorResponse(404, "Not found", false);
      }

      if ((await env.PositionsMetadata.get(BigInt(id).toString())) == null) {
        return errorResponse(404, "Token metadata not found", true);
      }

      return new Response(generateSvg(Number(id), env.STARKNET_CHAIN_ID), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400, must-revalidate",
        },
      });
    }

    return errorResponse(404, "Invalid path", false);
  },
};
