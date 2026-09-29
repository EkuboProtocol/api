// Validators for cacheable GET responses, so a client polling an unchanged
// response gets a bodiless 304 instead of the full payload again.
//
// The tag is a hash of the body rather than anything per-colo, so every
// Cloudflare location hands out the same tag for the same content. Cloudflare
// weakens strong tags when it compresses a response, which is why the
// comparison below ignores the W/ prefix; If-None-Match uses weak comparison
// anyway (RFC 9110 13.1.2).

const HEADERS_KEPT_ON_304 = ["cache-control", "etag", "age", "last-modified"];

export async function withEtag(response: Response): Promise<Response> {
  if (response.status !== 200 || response.headers.has("etag")) {
    return response;
  }

  const body = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const tag = Array.from(digest.subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const headers = new Headers(response.headers);
  headers.set("etag", `"${tag}"`);
  return new Response(body, { status: response.status, headers });
}

function opaqueTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}

function matchesIfNoneMatch(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") return true;
  const current = opaqueTag(etag);
  return ifNoneMatch.split(",").some((tag) => opaqueTag(tag) === current);
}

export function notModified(
  request: Request,
  response: Response,
): Response | null {
  const ifNoneMatch = request.headers.get("if-none-match");
  const etag = response.headers.get("etag");
  if (
    !ifNoneMatch ||
    !etag ||
    response.status !== 200 ||
    !matchesIfNoneMatch(ifNoneMatch, etag)
  ) {
    return null;
  }

  const headers = new Headers();
  for (const name of HEADERS_KEPT_ON_304) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(null, { status: 304, headers });
}
