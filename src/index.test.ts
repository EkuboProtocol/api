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
        expect(resp.headers.get('cache-control')).toMatchInlineSnapshot('"public, max-age=86400, must-revalidate"')
        expect(text).toMatchInlineSnapshot(`
          "
                  <svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 50 50\\">
                      <g fill=\\"none\\" stroke=\\"black\\" stroke-width=\\"2\\">
                          <path fill=\\"#101556\\" d=\\"M20 8 Q28 16, 28 24 Q28 28, 24 30.400000000000002 Q28 32, 25.6 33.6 Q28 35.2, 24 37.6 Q20 38.400000000000006, 16 37.6 Q13.600000000000001 35.2, 14.4 33.6 Q16 32, 20 30.400000000000002 Q16 28, 16 24 Q16 16, 24 8 z\\"/>
                          <circle fill=\\"#874800\\" cx=\\"13.600000000000001\\" cy=\\"16\\" r=\\"2.4000000000000004\\"/>
                          <circle fill=\\"#874800\\" cx=\\"26.400000000000002\\" cy=\\"16\\" r=\\"2.4000000000000004\\"/>
                          <path fill=\\"#000000\\" d=\\"M16 25.6 Q20 28, 24 25.6 T32 25.6\\"/>
                      </g>
                  </svg>
              "
        `)
    });
});
