import type {UnstableDevWorker} from "wrangler";
import {unstable_dev} from "wrangler";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

describe("Worker", () => {
    let worker: UnstableDevWorker;

    beforeAll(async () => {
        worker = await unstable_dev("src/index.ts", {
            experimental: {disableExperimentalWarning: true},
        });
    });

    afterAll(async () => {
        await worker.stop();
    });

    it('fails with empty path', async () => {
        for (const path of ['/', '/abc', '/12-asa', '/12/12']) {
            const resp = await worker.fetch(path, {});
            expect(resp.status).toEqual(404)
            expect(resp.headers.get('content-type')).toEqual('application/json')
            expect(await resp.json()).toEqual({error: "Invalid path"})
        }
    })

    it('fails with wrong method', async () => {
        for (const method of ['post','put','delete']) {
            const resp = await worker.fetch('/1', {method});
            expect(resp.status).toEqual(400)
            expect(await resp.json()).toEqual({error: 'Invalid method'})
        }
    })


    it("should return a json string for the json endpoint", async () => {
        const resp = await worker.fetch('/1');
        expect(resp.status).toEqual(200);

        const json: any = await resp.json();

        expect(resp.headers.get('content-type')).toEqual('application/json')
        expect(resp.headers.get('cache-control')).toMatchInlineSnapshot('"public, max-age=60, must-revalidate"')
        expect(json.attributes).toEqual([]);
        expect(json.description).toMatchInlineSnapshot('"An NFT that represents a liquidity position in Ekubo"')
        expect(json.name).toMatchInlineSnapshot('"Ekubo NFT #1"')
        expect(new URL(json.image).pathname).toMatchInlineSnapshot('"/1/image.svg"')
    });

    it("should return an image for the image endpoint", async () => {
        const resp = await worker.fetch('/1/image.svg');
        expect(resp.status).toEqual(200);

        const text: any = await resp.text();

        expect(resp.headers.get('content-type')).toEqual('image/svg+xml')
        expect(resp.headers.get('cache-control')).toMatchInlineSnapshot('"public, max-age=60, must-revalidate"')
        expect(text).toMatchInlineSnapshot(`
          "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 50 50\\">
                <g fill=\\"none\\" stroke=\\"black\\" stroke-width=\\"2\\">
                  <path fill=\\"green\\" d=\\"M25 10 Q35 20, 35 30 Q35 35, 30 38 Q35 40, 32 42 Q35 44, 30 47 Q25 48, 20 47 Q17 44, 18 42 Q20 40, 25 38 Q20 35, 20 30 Q20 20, 30 10 z\\"/>
                  <circle fill=\\"pink\\" cx=\\"17\\" cy=\\"20\\" r=\\"3\\"/>
                  <circle fill=\\"pink\\" cx=\\"33\\" cy=\\"20\\" r=\\"3\\"/>
                  <path fill=\\"pink\\" d=\\"M20 32 Q25 35, 30 32 T40 32\\"/>
                </g>
              </svg>"
        `)
    });
});
