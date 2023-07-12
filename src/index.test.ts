import type { UnstableDevWorker } from "wrangler";
import { unstable_dev } from "wrangler";

describe("Worker", () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it("fails with empty path", async () => {
    for (const path of [
      "/",
      "/abc/gmkldamg",
      "/12-asa/321f/1",
      "/12/12/fdsafasd",
    ]) {
      const resp = await worker.fetch(path, {});
      expect(resp.status).toEqual(404);
      expect(resp.headers.get("content-type")).toEqual(
        "application/json; charset=utf-8"
      );
      expect(await resp.json()).toEqual({ error: "Not Found", status: 404 });
    }
  });

  it("fails with wrong method", async () => {
    for (const method of ["post", "put", "delete"]) {
      const resp = await worker.fetch("/1", { method });
      expect(resp.status).toEqual(404);
      expect(await resp.json()).toEqual({ error: "Not Found", status: 404 });
    }
  });

  it("cors response to options request", async () => {
    const resp = await worker.fetch("/1", {
      method: "options",
      headers: { "access-control-request-headers": "x-auth-token" },
    });
    expect(resp.status).toEqual(200);
    expect(await resp.text()).toEqual("");
    expect(resp.headers.get("access-control-allow-origin")).toEqual(null);
    expect(resp.headers.get("access-control-allow-methods")).toEqual("GET");
    expect(resp.headers.get("access-control-max-age")).toEqual("86400");
    expect(resp.headers.get("access-control-allow-headers")).toEqual(null);
  });

  it.skip("returns 404 if not in kv", async () => {
    const resp = await worker.fetch("/1");
    expect(resp.status).toEqual(404);

    const json: any = await resp.json();

    expect(resp.headers.get("content-type")).toEqual("application/json");
    expect(resp.headers.get("cache-control")).toMatchInlineSnapshot(
      '"public, max-age=60, must-revalidate"'
    );
    expect(json.attributes).toEqual([]);
    expect(json.description).toMatchInlineSnapshot(
      '"An NFT that represents a liquidity position in Ekubo"'
    );
    expect(json.name).toMatchInlineSnapshot('"Ekubo NFT #1"');
    expect(new URL(json.image).pathname).toMatchInlineSnapshot(
      '"/1/image.svg"'
    );
  });

  it.skip("should return an image for the image endpoint", async () => {
    const resp = await worker.fetch("/1/image.svg");
    expect(resp.status).toEqual(200);

    const text: any = await resp.text();

    expect(resp.headers.get("content-type")).toEqual("image/svg+xml");
    expect(resp.headers.get("cache-control")).toMatchInlineSnapshot(
      '"public, max-age=86400, must-revalidate"'
    );
    expect(text).toMatchInlineSnapshot(`
"
    <svg width="134" height="134" viewBox="0 0 134 134" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="67" cy="67" r="84" fill="url(#paint0_linear_1_30)"/>
        <path fill-rule="evenodd" clip-rule="evenodd"
            transform="rotate(320, 67, 67)"
            d="M40 54.0769C40 47.9593 80 43 80 43H92.9C99.0304 43 104 47.9593 104 54.0769V79.9231C104 86.0407 99.0304 91 92.9 91H41.1C34.9696 91 30 86.0407 30 79.9231V54.0769ZM67 67C67 75.1568 60.3738 81.7692 52.2 81.7692C44.0262 81.7692 37.4 75.1568 37.4 67C37.4 58.8432 44.0262 52.2308 52.2 52.2308C60.3738 52.2308 67 58.8432 67 67ZM67 67C67 58.8432 73.6262 52.2308 81.8 52.2308C89.9738 52.2308 96.6 58.8432 96.6 67C96.6 75.1568 89.9738 81.7692 81.8 81.7692C73.6262 81.7692 67 75.1568 67 67Z"
            fill="#F1F0FA"/>
        <defs>
            <linearGradient id="paint0_linear_1_30" x1="0" y1="0" x2="134" y2="134" gradientUnits="userSpaceOnUse">
                <stop stop-color="#a082a0"/>
                <stop offset="1" stop-color="#ffc98c"/>
            </linearGradient>
        </defs>
    </svg>
    "
`);
  });
});
