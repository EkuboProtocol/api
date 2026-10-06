import { beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { createWorker } from "./worker";

// A Cache API stand-in that, like the real one, drops entries once their
// max-age has passed.
const entries = new Map<string, { response: Response; expires: number }>();
const cacheStub = {
  async match(key: URL) {
    const entry = entries.get(key.href);
    if (!entry || entry.expires <= Date.now()) return undefined;
    return entry.response.clone();
  },
  async put(key: URL, response: Response) {
    const maxAge = /max-age=(\d+)/.exec(
      response.headers.get("cache-control") ?? "",
    );
    entries.set(key.href, {
      response: response.clone(),
      expires: Date.now() + Number(maxAge?.[1] ?? 0) * 1000,
    });
  },
};
(globalThis as unknown as { caches: unknown }).caches = { default: cacheStub };

let computed = 0;
const app = {
  fetch: async () => {
    computed++;
    return new Response(JSON.stringify({ version: computed }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=600, stale-while-revalidate=86400",
      },
    });
  },
};

const worker = createWorker(app);

const body = (response: Response): Promise<unknown> => response.json();

function run(url = "https://api.test/overview/tvl") {
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return worker
    .fetch(new Request(url), {}, ctx)
    .then(async (response: Response) => ({ response, waits }));
}

describe("worker stale-while-revalidate", () => {
  beforeEach(() => {
    entries.clear();
    computed = 0;
    setSystemTime(new Date("2026-10-06T00:00:00Z"));
  });

  it("serves the stale copy and refreshes it in the background", async () => {
    const first = await run();
    expect(await body(first.response)).toEqual({ version: 1 });

    setSystemTime(new Date("2026-10-06T00:05:00Z"));
    const fresh = await run();
    expect(await body(fresh.response)).toEqual({ version: 1 });
    expect(fresh.waits).toHaveLength(0);

    setSystemTime(new Date("2026-10-06T00:11:00Z"));
    const stale = await run();
    expect(await body(stale.response)).toEqual({ version: 1 });
    expect(stale.response.headers.get("cache-control")).toBe(
      "public, max-age=600, stale-while-revalidate=86400",
    );
    expect(stale.response.headers.get("etag")).not.toBeNull();
    expect(stale.waits).toHaveLength(1);
    await Promise.all(stale.waits);
    expect(computed).toBe(2);

    const refreshed = await run();
    expect(await body(refreshed.response)).toEqual({ version: 2 });
    expect(refreshed.waits).toHaveLength(0);
  });

  it("recomputes once the stale window has passed", async () => {
    await run();
    setSystemTime(new Date("2026-10-07T00:11:00Z"));
    const { response, waits } = await run();
    expect(await body(response)).toEqual({ version: 2 });
    expect(waits).toHaveLength(0);
  });
});
