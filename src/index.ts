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
            return new Response('', {
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
