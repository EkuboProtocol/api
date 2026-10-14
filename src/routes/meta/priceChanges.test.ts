import { afterEach, describe, expect, mock, test } from "bun:test";
import { env, stubQuery } from "../../contract/harness";
import {
  USDC,
  USDC_DECIMAL,
  WETH,
  WETH_DECIMAL,
} from "../../contract/fixtures";
import { app } from "../../router";

afterEach(() => {
  mock.restore();
});

function get(path: string) {
  return app.request(path, {}, env);
}

describe("/tokens/price-changes", () => {
  test("answers in request order, once per token, skipping unpriced tokens", async () => {
    stubQuery("getErc20TokenUsdPriceChanges", [
      {
        chain_id: 1n,
        token_address: USDC_DECIMAL,
        usd_price: 1,
        usd_price_24h_ago: null,
      },
      {
        chain_id: 1n,
        token_address: WETH_DECIMAL,
        usd_price: 2500,
        usd_price_24h_ago: 2400,
      },
    ]);

    const response = await get(
      `/tokens/price-changes?id=0x1:${WETH}&id=1:${USDC}&id=1:${WETH}&id=1:0x1234`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await response.json()) as unknown).toEqual([
      {
        chain_id: "0x1",
        address: WETH,
        usd_price: 2500,
        usd_price_24h_ago: 2400,
      },
      {
        chain_id: "0x1",
        address: USDC,
        usd_price: 1,
        usd_price_24h_ago: null,
      },
    ]);
  });

  test("rejects more than 100 tokens", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `id=1:0x${(index + 1).toString(16)}`,
    ).join("&");

    const response = await get(`/tokens/price-changes?${ids}`);

    expect(response.status).toBe(400);
  });
});
