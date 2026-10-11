import { expect, spyOn, test } from "bun:test";
import { app } from "../../router";
import { Queries } from "../../queries";
import { StatusError } from "../../shared/errors";

const pool = `0x${"1".repeat(64)}`;
const base = `/launches/31337/${pool}`;
const localEnv = {
  PG_CONNECTION_STRING: "postgres://fixture:fixture@127.0.0.1:1/unused",
};
const request = (path: string, env = {}) =>
  app.fetch(new Request(`http://localhost${path}`), env);

test("hosted launch entrypoints stay disabled without database or live pins", async () => {
  for (const path of [
    "/launches?chainId=31337",
    base,
    `${base}/swaps`,
    `${base}/claims`,
  ]) {
    for (const env of [{}, localEnv]) {
      const response = await request(path, env);
      expect(response.status).toBe(404);
      expect((await response.json()) as unknown).toEqual({
        status: 404,
        error: "Launch support is disabled",
      });
    }
  }
});

test("invalid arguments return 400 and the removed stats route returns 404", async () => {
  for (const path of [
    "/launches",
    "/launches?chainId=-1",
    "/launches?chainId=31337&limit=0",
    "/launches?chainId=31337&before_event_id=9223372036854775808",
    `${base}/swaps?after_event_id=-9223372036854775809`,
    "/launches/31337/0x1234",
    "/launches/31337/NaN",
  ]) {
    const response = await request(path);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { status: number }).status).toBe(400);
  }
  expect((await request(`${base}/stats`)).status).toBe(404);
});

test("stale-index errors retain the established 503 error envelope", async () => {
  const stub = spyOn(
    Queries.prototype,
    "readZeroSeedDetail",
  ).mockImplementation(() => {
    throw new StatusError(503, "Launch index is stale or has no coherent head");
  });
  try {
    const response = await request(base, localEnv);
    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toEqual({
      status: 503,
      error: "Launch index is stale or has no coherent head",
    });
  } finally {
    stub.mockRestore();
  }
});
