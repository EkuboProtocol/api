import { describe, expect, it } from "bun:test";
import {
  fromStoredResponse,
  parseSwrPolicy,
  refreshOnce,
  toStoredResponse,
} from "./staleWhileRevalidate";

const SWR = "public, max-age=600, stale-while-revalidate=86400";

function response(cacheControl: string) {
  return new Response('{"ok":true}', {
    status: 200,
    headers: { "cache-control": cacheControl, etag: '"abc"' },
  });
}

describe("parseSwrPolicy", () => {
  it("reads max-age and stale-while-revalidate", () => {
    expect(parseSwrPolicy(SWR)).toEqual({
      maxAge: 600,
      staleWhileRevalidate: 86400,
    });
  });

  it("ignores responses without stale-while-revalidate", () => {
    expect(parseSwrPolicy("public, max-age=600")).toBeNull();
    expect(parseSwrPolicy("public,max-age=300,must-revalidate")).toBeNull();
    expect(parseSwrPolicy(null)).toBeNull();
  });

  it("does not read s-maxage as max-age", () => {
    expect(parseSwrPolicy("s-maxage=5, stale-while-revalidate=10")).toBeNull();
  });
});

describe("stored responses", () => {
  it("leaves responses without stale-while-revalidate untouched", async () => {
    const original = response("public, max-age=600");
    const stored = toStoredResponse(original, 0);
    expect(stored).toBe(original);
    expect(fromStoredResponse(stored, 10_000_000)).toEqual({
      response: stored,
      stale: false,
    });
  });

  it("stores for max-age + stale-while-revalidate and restores headers", async () => {
    const stored = toStoredResponse(response(SWR), 1_000);
    expect(stored.headers.get("cache-control")).toBe("public, max-age=87000");

    const { response: served, stale } = fromStoredResponse(stored, 1_000);
    expect(stale).toBe(false);
    expect(served.headers.get("cache-control")).toBe(SWR);
    expect(served.headers.get("etag")).toBe('"abc"');
    expect(
      [...served.headers.keys()].some((k) => k.startsWith("x-ekubo")),
    ).toBe(false);
    expect(await served.text()).toBe('{"ok":true}');
  });

  it("is stale only after max-age", () => {
    const at = (now: number) =>
      fromStoredResponse(toStoredResponse(response(SWR), 0), now).stale;
    expect(at(600_000)).toBe(false);
    expect(at(600_001)).toBe(true);
  });
});

describe("refreshOnce", () => {
  it("runs one refresh per key at a time", async () => {
    let release!: () => void;
    let runs = 0;
    const refresh = () => {
      runs++;
      return new Promise<void>((resolve) => (release = resolve));
    };

    const first = refreshOnce("k", refresh);
    expect(first).not.toBeNull();
    expect(refreshOnce("k", refresh)).toBeNull();
    release();
    await first;
    expect(runs).toBe(1);

    const again = refreshOnce("k", async () => {
      runs++;
    });
    await again;
    expect(runs).toBe(2);
  });
});
