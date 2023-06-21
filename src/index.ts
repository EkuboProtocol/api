export interface Env {
    // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
    // MY_KV_NAMESPACE: KVNamespace;
    //
    // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
    // MY_DURABLE_OBJECT: DurableObjectNamespace;
    //
    // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
    // MY_BUCKET: R2Bucket;
    //
    // Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
    // MY_SERVICE: Fetcher;

    STARKNET_RPC_URL: string
}

interface NFTMetadata {
    name: string;

    description: string;

    image: string;

    attributes: {
        trait_type: string;
        value: string;
    }[]
}

const NFT_METADATA_PATH = /^\/(\d+)$/;
const NFT_IMAGE_PATH = /^\/(\d+)\/image.svg$/;


function generateSvg(token_id: bigint) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
      <g fill="none" stroke="black" stroke-width="2">
        <path fill="green" d="M25 10 Q35 20, 35 30 Q35 35, 30 38 Q35 40, 32 42 Q35 44, 30 47 Q25 48, 20 47 Q17 44, 18 42 Q20 40, 25 38 Q20 35, 20 30 Q20 20, 30 10 z"/>
        <circle fill="pink" cx="17" cy="20" r="3"/>
        <circle fill="pink" cx="33" cy="20" r="3"/>
        <path fill="pink" d="M20 32 Q25 35, 30 32 T40 32"/>
      </g>
    </svg>`;
}

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        if (request.method !== 'GET') {
            return new Response(JSON.stringify({error: 'Invalid method'}), {
                status: 400,
            })
        }

        const url = new URL(request.url);

        const path = url.pathname;

        if (NFT_METADATA_PATH.test(path)) {
            const [, id] = NFT_METADATA_PATH.exec(path)!

            const metadata: NFTMetadata = {
                name: `Ekubo NFT #${id}`,
                description: 'An NFT that represents a liquidity position in Ekubo',
                image: `${url.origin}/${id}/image.svg`,
                attributes: []
            }
            return new Response(JSON.stringify(metadata), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'cache-control': 'public, max-age=60, must-revalidate'
                }
            });
        } else if (NFT_IMAGE_PATH.test(path)) {
            let [, id] = NFT_METADATA_PATH.exec(path)!
            return new Response(generateSvg(BigInt(id)), {
                status: 200,
                headers: {
                    'content-type': 'image/svg+xml',
                    'cache-control': 'public, max-age=60, must-revalidate'
                },
            })
        }


        return new Response(JSON.stringify({error: 'Invalid path'}), {
            status: 404,
            headers: {
                'content-type': 'application/json',
                'cache-control': 'public, max-age=60, must-revalidate'
            }
        });
    },
};
