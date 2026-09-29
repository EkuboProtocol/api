import { describe, expect, test } from "bun:test";
import { notModified, withEtag } from "./etag";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
    },
  });
}

function conditional(ifNoneMatch: string) {
  return new Request("https://example.com/tokens", {
    headers: { "if-none-match": ifNoneMatch },
  });
}

describe("withEtag", () => {
  test("tags identical bodies identically and keeps the body", async () => {
    const a = await withEtag(jsonResponse([{ a: 1 }]));
    const b = await withEtag(jsonResponse([{ a: 1 }]));
    const c = await withEtag(jsonResponse([{ a: 2 }]));

    expect(a.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(a.headers.get("etag")).toBe(b.headers.get("etag"));
    expect(a.headers.get("etag")).not.toBe(c.headers.get("etag"));
    expect(a.headers.get("cache-control")).toBe("public, max-age=60");
    expect(JSON.parse(await a.text())).toEqual([{ a: 1 }]);
  });

  test("leaves non-200 responses alone", async () => {
    const response = await withEtag(jsonResponse({ error: "x" }, 404));
    expect(response.headers.has("etag")).toBe(false);
  });
});

describe("notModified", () => {
  test("answers a matching If-None-Match with a bodiless 304", async () => {
    const response = await withEtag(jsonResponse([1, 2, 3]));
    const etag = response.headers.get("etag")!;

    const result = notModified(conditional(etag), response);

    expect(result?.status).toBe(304);
    expect(result?.headers.get("etag")).toBe(etag);
    expect(result?.headers.get("cache-control")).toBe("public, max-age=60");
    expect(result?.headers.has("content-type")).toBe(false);
    expect(await result?.text()).toBe("");
  });

  test("matches the weak form Cloudflare sends after compressing", async () => {
    const response = await withEtag(jsonResponse([1]));
    const etag = response.headers.get("etag")!;

    expect(
      notModified(conditional(`"other", W/${etag}`), response)?.status,
    ).toBe(304);
  });

  test("returns null when the tag differs or is absent", async () => {
    const response = await withEtag(jsonResponse([1]));

    expect(notModified(conditional('"stale"'), response)).toBeNull();
    expect(
      notModified(new Request("https://example.com/tokens"), response),
    ).toBeNull();
    expect(notModified(conditional("*"), jsonResponse([1]))).toBeNull();
  });
});
