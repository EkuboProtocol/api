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
          "
                  <svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 50 50\\">
                      <g fill=\\"none\\" stroke=\\"black\\" stroke-width=\\"2\\">
                          <path fill=\\"#100000\\" d=\\"M2.5 1 Q3.5 2, 3.5 3 Q3.5 3.5, 3 3.8000000000000003 Q3.5 4, 3.2 4.2 Q3.5 4.4, 3 4.7 Q2.5 4.800000000000001, 2 4.7 Q1.7000000000000002 4.4, 1.8 4.2 Q2 4, 2.5 3.8000000000000003 Q2 3.5, 2 3 Q2 2, 3 1 z\\"/>
                          <circle fill=\\"#000000\\" cx=\\"1.7000000000000002\\" cy=\\"2\\" r=\\"0.30000000000000004\\"/>
                          <circle fill=\\"#000000\\" cx=\\"3.3000000000000003\\" cy=\\"2\\" r=\\"0.30000000000000004\\"/>
                          <path fill=\\"#000000\\" d=\\"M2 3.2 Q2.5 3.5, 3 3.2 T4 3.2\\"/>
                      </g>
                  </svg>
              "
        `)
    });
});
