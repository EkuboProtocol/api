import { expect, spyOn, test } from "bun:test";
import { app } from "../../router";
import { Queries } from "../../queries";
import { StatusError } from "../../shared/errors";
import { LOCAL_INSTANCES, LOCAL_QUOTES } from "./policy";
import { LaunchQueries } from "./queries";

const pool = `0x${"1".repeat(64)}`;
const base = `/launches/31337/${pool}`;
const localEnv = {
  PG_CONNECTION_STRING: "postgres://fixture:fixture@127.0.0.1:1/unused",
};
const request = (path: string, env = {}) =>
  app.fetch(new Request(`http://localhost${path}`), env);

test("hosted launch entrypoints stay disabled without database or live pins", async () => {
  for (const path of [
    "/launches",
    "/launches?chainId=31337",
    "/launches?status=upcoming&owner=0x1",
    base,
    `${base}/swaps`,
    `${base}/claims`,
    `${base}/owners`,
  ]) {
    for (const env of [{}, localEnv]) {
      const response = await request(path, env);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        status: 404,
        error: "Launch support is disabled",
      });
    }
  }
});

test("the hosted reader enables no instance and no ERC-20 quote", async () => {
  const hosted = new LaunchQueries((() => {
    throw new Error("no query may run");
  }) as never);
  expect(Reflect.get(hosted, "enabled")).toEqual([]);
  expect(Reflect.get(hosted, "quotes")).toEqual([]);
  const refused = await hosted
    .list({ status: "all", orderBy: "market_cap", offset: 0, limit: 1 })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(refused).toBeInstanceOf(StatusError);
  expect(refused).toMatchObject({ status: 404 });
  // even a harness that passes the reviewed lists is refused when not local
  const notLocal = new LaunchQueries((() => {}) as never, {
    localHarness: false,
    instances: LOCAL_INSTANCES,
    quotes: LOCAL_QUOTES,
    maxIndexAgeSeconds: 60,
  });
  expect(Reflect.get(notLocal, "enabled")).toEqual([]);
  expect(Reflect.get(notLocal, "quotes")).toEqual([]);
});

test("invalid arguments return 400 naming the parameter", async () => {
  for (const [path, parameter] of [
    ["/launches?chainId=-1", "chainId"],
    ["/launches?chainId=abc", "chainId"],
    ["/launches?limit=0", "limit"],
    ["/launches?limit=201", "limit"],
    ["/launches?offset=-1", "offset"],
    ["/launches?offset=1.5", "offset"],
    ["/launches?status=live", "status"],
    ["/launches?status=", "status"],
    ["/launches?order_by=volume", "order_by"],
    [`/launches?owner=0x1${"0".repeat(40)}`, "owner"],
    ["/launches?owner=alice", "owner"],
    ["/launches?creator=owner", "creator"],
    [`${base}/swaps?after_event_id=-9223372036854775809`, "after_event_id"],
    [`${base}/claims?after_event_id=01`, "after_event_id"],
    [`${base}/owners?limit=201`, "limit"],
    [`/launches/31337/0x1${"0".repeat(64)}`, "poolId"],
    ["/launches/31337/NaN", "poolId"],
    [`/launches/x/${pool}`, "chainId"],
  ] as const) {
    const response = await request(path);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { status: number; error: string };
    expect(body.status).toBe(400);
    expect(body.error).toContain(parameter);
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
    expect(await response.json()).toEqual({
      status: 503,
      error: "Launch index is stale or has no coherent head",
    });
  } finally {
    stub.mockRestore();
  }
});
