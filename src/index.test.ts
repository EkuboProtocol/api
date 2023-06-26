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
                          <path fill=\\"#101390\\" d=\\"M7.5 3 Q10.5 6, 10.5 9 Q10.5 10.5, 9 11.4 Q10.5 12, 9.6 12.6 Q10.5 13.2, 9 14.1 Q7.5 14.399999999999999, 6 14.1 Q5.1 13.2, 5.3999999999999995 12.6 Q6 12, 7.5 11.4 Q6 10.5, 6 9 Q6 6, 9 3 z\\"/>
                          <circle fill=\\"#422300\\" cx=\\"5.1\\" cy=\\"6\\" r=\\"0.8999999999999999\\"/>
                          <circle fill=\\"#422300\\" cx=\\"9.9\\" cy=\\"6\\" r=\\"0.8999999999999999\\"/>
                          <path fill=\\"#000000\\" d=\\"M6 9.6 Q7.5 10.5, 9 9.6 T12 9.6\\"/>
                      </g>
                  </svg>
              "
        `)
    });
});
