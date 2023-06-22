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


class BigIntLCG {
    private _a: bigint;
    private _c: bigint;
    private _m: bigint;
    private _seed: bigint;

    constructor(seed: bigint) {
        // Parameters for a widely used LCG (Numerical Recipes)
        this._a = BigInt(1664525);
        this._c = BigInt(1013904223);
        this._m = BigInt(2) ** BigInt(32);
        this._seed = seed;
    }

    next(): bigint {
        this._seed = (this._a * this._seed + this._c) % this._m;
        return this._seed;
    }
}

function generateSvg(seed: bigint): string {
    const lcg = new BigIntLCG(seed);
    const randString = lcg.next().toString();
    const bodyColor = `#${randString.slice(0, 6).padEnd(6, '0')}`;
    const eyeColor = `#${randString.slice(6, 12).padEnd(6, '0')}`;
    const mouthColor = `#${randString.slice(12, 18).padEnd(6, '0')}`;

    const ghostSize = Number(randString.slice(-1)) / 10;

    const ghostSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
            <g fill="none" stroke="black" stroke-width="2">
                <path fill="${bodyColor}" d="M${25 * ghostSize} ${10 * ghostSize} Q${35 * ghostSize} ${20 * ghostSize}, ${35 * ghostSize} ${30 * ghostSize} Q${35 * ghostSize} ${35 * ghostSize}, ${30 * ghostSize} ${38 * ghostSize} Q${35 * ghostSize} ${40 * ghostSize}, ${32 * ghostSize} ${42 * ghostSize} Q${35 * ghostSize} ${44 * ghostSize}, ${30 * ghostSize} ${47 * ghostSize} Q${25 * ghostSize} ${48 * ghostSize}, ${20 * ghostSize} ${47 * ghostSize} Q${17 * ghostSize} ${44 * ghostSize}, ${18 * ghostSize} ${42 * ghostSize} Q${20 * ghostSize} ${40 * ghostSize}, ${25 * ghostSize} ${38 * ghostSize} Q${20 * ghostSize} ${35 * ghostSize}, ${20 * ghostSize} ${30 * ghostSize} Q${20 * ghostSize} ${20 * ghostSize}, ${30 * ghostSize} ${10 * ghostSize} z"/>
                <circle fill="${eyeColor}" cx="${17 * ghostSize}" cy="${20 * ghostSize}" r="${3 * ghostSize}"/>
                <circle fill="${eyeColor}" cx="${33 * ghostSize}" cy="${20 * ghostSize}" r="${3 * ghostSize}"/>
                <path fill="${mouthColor}" d="M${20 * ghostSize} ${32 * ghostSize} Q${25 * ghostSize} ${35 * ghostSize}, ${30 * ghostSize} ${32 * ghostSize} T${40 * ghostSize} ${32 * ghostSize}"/>
            </g>
        </svg>
    `;

    return ghostSvg;
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
            let [, id] = NFT_IMAGE_PATH.exec(path)!
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
