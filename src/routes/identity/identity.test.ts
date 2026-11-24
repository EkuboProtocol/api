import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { RateLimit } from "@cloudflare/workers-types";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { serializeErc6492Signature } from "viem";
import type { Env } from "../../env";
import { app } from "../../router";
import { responseSchema } from "../../contract/harness";
import { fakeD1 } from "../../testing/fakeD1";
import { STARKNET_MAINNET_CHAIN_ID } from "./chains";
import { consumeNonce } from "./store";
import { XUnlinkCompleteResponseType } from "./schemas";
import { sha256 } from "./crypto";

const MIGRATIONS = join(import.meta.dir, "../../../migrations/identity");
const STARKNET = `0x${STARKNET_MAINNET_CHAIN_ID.toString(16)}`;
const RETURN_ORIGIN = "https://interface-9yz.pages.dev";

let env: Env;
let sqlite: Database;
let xAccount: { id: string; username: string };
// Contract accounts: address -> chain IDs on which their ERC-1271 check passes.
let contracts: Map<string, Set<string>>;
// Exact eth_call return data for an address, overriding contracts.
let rawReturns: Map<string, string>;
let erc6492Valid: boolean;
let starknetResult: string[] | "error";
let rpcDown: boolean;
let limited: boolean;
let calls: { url: string; body: string }[];

const limiter: RateLimit = {
  limit: async () => ({ success: !limited }),
};

function jsonRpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function evmRpc(
  chainId: string,
  body: { id: unknown; method: string; params: [{ to?: string }] },
) {
  if (body.method !== "eth_call") return jsonRpc(body.id, "0x1");
  const to = body.params[0].to?.toLowerCase();
  if (to === undefined) {
    return jsonRpc(
      body.id,
      `0x${(erc6492Valid ? 1 : 0).toString(16).padStart(64, "0")}`,
    );
  }
  const raw = rawReturns.get(to);
  if (raw !== undefined) return jsonRpc(body.id, raw);
  const valid = contracts.get(to)?.has(chainId) ?? false;
  return jsonRpc(body.id, valid ? `0x1626ba7e${"0".repeat(56)}` : "0x");
}

function starknetRpc(body: { id: unknown }) {
  if (starknetResult === "error") {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: 40, message: "Contract error" },
    });
  }
  return jsonRpc(body.id, starknetResult);
}

const X_RESPONSES: Record<string, () => Response> = {
  "https://api.x.com/2/oauth2/token": () =>
    Response.json({ access_token: "access-token", token_type: "bearer" }),
  "https://api.x.com/2/users/me": () => Response.json({ data: xAccount }),
  "https://api.x.com/2/oauth2/revoke": () => new Response("{}"),
};

// Contract-account signatures are checked only against Ekubo's Alchemy app.
const RPC_URLS: Record<string, string> = {
  "1": "https://eth-mainnet.g.alchemy.com/v2/alchemy-key",
  "8453": "https://base-mainnet.g.alchemy.com/v2/alchemy-key",
  [STARKNET_MAINNET_CHAIN_ID.toString()]:
    "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/alchemy-key",
};

function rpcResponse(chainId: string, body: string) {
  if (rpcDown) return new Response("bad gateway", { status: 502 });
  const parsed = JSON.parse(body);
  return chainId === STARKNET_MAINNET_CHAIN_ID.toString()
    ? starknetRpc(parsed)
    : evmRpc(chainId, parsed);
}

function bodyText(body: RequestInit["body"]): string {
  if (typeof body === "string") return body;
  return body instanceof URLSearchParams ? body.toString() : "";
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = input instanceof Request ? input.url : String(input);
  const body = bodyText(init?.body);
  calls.push({ url, body });
  const x = X_RESPONSES[url];
  if (x) return x();
  const rpc = Object.entries(RPC_URLS).find(([, rpcUrl]) => rpcUrl === url);
  if (rpc) return rpcResponse(rpc[0], body);
  throw new Error(`Unexpected fetch ${url}`);
}

beforeEach(() => {
  const db = fakeD1(MIGRATIONS);
  sqlite = db.sqlite;
  env = {
    IDENTITY_DB: db.d1,
    PUBLIC_ORIGIN: "https://api.test",
    X_CLIENT_ID: "client-id",
    X_CLIENT_SECRET: "client-secret",
    X_LINK_RETURN_ORIGINS: `${RETURN_ORIGIN},https://*.interface-9yz.pages.dev`,
    ALCHEMY_API_KEY: "alchemy-key",
    IDENTITY_IP_LIMITER: limiter,
    IDENTITY_ADDRESS_LIMITER: limiter,
  };
  xAccount = { id: "1234567890", username: "alice" };
  contracts = new Map();
  rawReturns = new Map();
  erc6492Valid = false;
  starknetResult = ["0x56414c4944"];
  rpcDown = false;
  limited = false;
  calls = [];
  spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  mock.restore();
  setSystemTime();
});

function request(
  method: string,
  path: string,
  body?: unknown,
  ip = "203.0.113.7",
) {
  return app.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return (await response.json()) as T;
}

interface TypedData {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, string | number>;
  message: Record<string, string | number>;
}

interface Status {
  status: string;
  x_handle: string | null;
  typed_data: TypedData | null;
}

async function approveOnX(chainId: string, address: string, returnTo?: string) {
  const started = await request("POST", "/v1/identity/x/link/start", {
    chain_id: chainId,
    address,
    return_to: returnTo,
  });
  expect(started.status).toBe(200);
  const { link_id, authorization_url } = await json<{
    link_id: string;
    authorization_url: string;
  }>(started);
  const authorization = new URL(authorization_url);
  expect(authorization.origin).toBe("https://x.com");
  expect(authorization.searchParams.get("redirect_uri")).toBe(
    "https://api.test/v1/identity/x/callback",
  );
  const state = authorization.searchParams.get("state")!;
  const callback = await request(
    "GET",
    `/v1/identity/x/callback?state=${state}&code=oauth-code`,
  );
  return { linkId: link_id, callback };
}

async function codeFromPage(callback: Response) {
  expect(callback.status).toBe(200);
  const html = await callback.text();
  return /class="code">([A-Z0-9]+)</.exec(html)![1];
}

async function messageFor(linkId: string, code: string) {
  const response = await request(
    "GET",
    `/v1/identity/x/link/${linkId}?code=${code}`,
  );
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(
    responseSchema("/v1/identity/x/link/{link_id}")!.safeParse(body).error,
  ).toBeUndefined();
  return body as unknown as Status;
}

async function signEvm(account: PrivateKeyAccount, typedData: TypedData) {
  const { EIP712Domain: _, ...types } = typedData.types;
  const definition: Parameters<PrivateKeyAccount["signTypedData"]>[0] = {
    domain: typedData.domain,
    types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  };
  return account.signTypedData(definition);
}

async function link(
  chainId: string,
  address: string,
  sign: (typedData: TypedData) => Promise<string | string[]>,
) {
  const { linkId, callback } = await approveOnX(chainId, address);
  const code = await codeFromPage(callback);
  const status = await messageFor(linkId, code);
  const signature = await sign(status.typed_data!);
  const response = await request(
    "POST",
    `/v1/identity/x/link/${linkId}/complete`,
    { code, signature },
  );
  return { response, linkId, code, signature };
}

async function lookup(chainId: string, ...addresses: string[]) {
  const query = addresses.map((a) => `address=${a}`).join("&");
  const response = await request(
    "GET",
    `/v1/identity/addresses?chainId=${chainId}&${query}`,
  );
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(
    responseSchema("/v1/identity/addresses")!.safeParse(body).error,
  ).toBeUndefined();
  return body as {
    identities: Record<
      string,
      { x_handle: string; scope: string; signature_kind: string } | null
    >;
  };
}

function history() {
  return sqlite
    .prepare(
      "SELECT address, x_handle, end_reason FROM link_history ORDER BY id",
    )
    .all();
}

describe("linking an EOA", () => {
  test("links the address on every EVM chain and returns the identity", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { response } = await link("1", account.address, (td) =>
      signEvm(account, td),
    );
    expect(response.status).toBe(200);
    const body = await json<{ identity: Record<string, string> }>(response);
    expect(body.identity).toMatchObject({
      x_user_id: "1234567890",
      x_handle: "alice",
      x_url: "https://x.com/i/user/1234567890",
      scope: "namespace",
      verified_chain_id: "1",
      signature_kind: "ecdsa",
    });

    const address = account.address.toLowerCase();
    for (const chain of ["1", "8453"]) {
      const { identities } = await lookup(chain, account.address);
      expect(identities[address]?.x_handle).toBe("alice");
    }
    const other = privateKeyToAccount(generatePrivateKey()).address;
    expect(
      (await lookup("1", other)).identities[other.toLowerCase()],
    ).toBeNull();
  });

  test("the message names the X account, the address, the chain and a 10-minute window", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId, callback } = await approveOnX("8453", account.address);
    const status = await messageFor(linkId, await codeFromPage(callback));
    const td = status.typed_data!;
    expect(td.primaryType).toBe("LinkXAccount");
    expect(td.domain).toEqual({
      name: "ekubo.org",
      version: "1",
      chainId: 8453,
    });
    expect(td.message.xUserId).toBe("1234567890");
    expect(td.message.xHandle).toBe("alice");
    expect(td.message.account).toBe(account.address.toLowerCase());
    expect(String(td.message.statement)).toContain("@alice");
    expect(Number(td.message.expiresAt) - Number(td.message.issuedAt)).toBe(
      600,
    );
  });

  test("the token exchange sends the PKCE verifier of the challenge", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const started = await json<{ authorization_url: string }>(
      await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const authorization = new URL(started.authorization_url);
    const state = authorization.searchParams.get("state");
    await request("GET", `/v1/identity/x/callback?state=${state}&code=c`);
    const token = calls.find((c) => c.url.endsWith("/oauth2/token"))!;
    const verifier = new URLSearchParams(token.body).get("code_verifier")!;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(await sha256(verifier)).toBe(
      authorization.searchParams.get("code_challenge")!,
    );
    const stored = sqlite
      .prepare("SELECT verifier, state_hash FROM link_attempts")
      .get();
    expect(stored).toEqual({ verifier: null, state_hash: null });
  });

  test("the access token is revoked and never stored", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const revoke = calls.find((c) => c.url.endsWith("/oauth2/revoke"));
    expect(revoke?.body).toContain("token=access-token");
    const dump =
      JSON.stringify(sqlite.prepare("SELECT * FROM link_attempts").all()) +
      JSON.stringify(sqlite.prepare("SELECT * FROM links").all());
    expect(dump).not.toContain("access-token");
  });
});

describe("replay and expiry", () => {
  test("a completed link cannot be completed again", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { response, linkId, code, signature } = await link(
      "1",
      account.address,
      (td) => signEvm(account, td),
    );
    expect(response.status).toBe(200);
    const again = await request(
      "POST",
      `/v1/identity/x/link/${linkId}/complete`,
      {
        code,
        signature,
      },
    );
    expect(again.status).toBe(404);
  });

  test("a signature from an earlier link does not complete a new one", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const first = await link("1", account.address, (td) =>
      signEvm(account, td),
    );
    expect(first.response.status).toBe(200);
    const { linkId, callback } = await approveOnX("1", account.address);
    const code = await codeFromPage(callback);
    const replay = await request(
      "POST",
      `/v1/identity/x/link/${linkId}/complete`,
      {
        code,
        signature: first.signature,
      },
    );
    expect(replay.status).toBe(401);
  });

  test("a nonce is used at most once", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId, callback } = await approveOnX("1", account.address);
    await codeFromPage(callback);
    const nonce = sqlite.prepare("SELECT * FROM nonces").get() as {
      nonce: string;
      issued_at: number;
      expires_at: number;
    };
    const params = {
      nonce: nonce.nonce,
      purpose: "link" as const,
      namespace: "evm" as const,
      address: account.address.toLowerCase(),
      chainId: "1",
      issuedAt: nonce.issued_at,
      expiresAt: nonce.expires_at,
    };
    const now = Math.floor(Date.now() / 1000);
    expect(await consumeNonce(env.IDENTITY_DB, params, now)).toBe(true);
    expect(await consumeNonce(env.IDENTITY_DB, params, now)).toBe(false);
    expect(linkId).toBeString();
  });

  test("a link expires 10 minutes after X approval", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId, callback } = await approveOnX("1", account.address);
    const code = await codeFromPage(callback);
    const status = await messageFor(linkId, code);
    const signature = await signEvm(account, status.typed_data!);
    setSystemTime(new Date(Date.now() + 601_000));
    const late = await request(
      "POST",
      `/v1/identity/x/link/${linkId}/complete`,
      {
        code,
        signature,
      },
    );
    expect(late.status).toBe(404);
    expect((await request("GET", `/v1/identity/x/link/${linkId}`)).status).toBe(
      404,
    );
  });

  test("an X approval after the start window is refused", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const started = await json<{ authorization_url: string }>(
      await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const state = new URL(started.authorization_url).searchParams.get("state");
    setSystemTime(new Date(Date.now() + 601_000));
    const callback = await request(
      "GET",
      `/v1/identity/x/callback?state=${state}&code=oauth-code`,
    );
    expect(callback.status).toBe(400);
    expect(await callback.text()).toContain("expired");
  });

  test("an OAuth state is accepted once", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const started = await json<{ authorization_url: string }>(
      await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const state = new URL(started.authorization_url).searchParams.get("state");
    const path = `/v1/identity/x/callback?state=${state}&code=oauth-code`;
    expect((await request("GET", path)).status).toBe(200);
    expect((await request("GET", path)).status).toBe(400);
  });
});

describe("proof of each side", () => {
  test("a signature by another key is refused", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const { response } = await link("1", account.address, (td) =>
      signEvm(other, td),
    );
    expect(response.status).toBe(401);
    expect(
      (await lookup("1", account.address)).identities[
        account.address.toLowerCase()
      ],
    ).toBeNull();
  });

  test("the message is not shown and nothing completes without the code from X", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId } = await approveOnX("1", account.address);
    const status = await json<Status>(
      await request("GET", `/v1/identity/x/link/${linkId}`),
    );
    expect(status.status).toBe("awaiting_signature");
    expect(status.typed_data).toBeNull();
    expect(status.x_handle).toBeNull();

    for (let i = 0; i < 4; i++) {
      const wrong = await request(
        "GET",
        `/v1/identity/x/link/${linkId}?code=AAAAAAAAAA`,
      );
      expect(wrong.status).toBe(403);
    }
    const last = await request(
      "POST",
      `/v1/identity/x/link/${linkId}/complete`,
      {
        code: "AAAAAAAAAA",
        signature: "0x00",
      },
    );
    expect(last.status).toBe(403);
    expect((await request("GET", `/v1/identity/x/link/${linkId}`)).status).toBe(
      404,
    );
  });

  test("before X approval the link is awaiting X and cannot complete", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const started = await json<{ link_id: string }>(
      await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const status = await json<Status>(
      await request(
        "GET",
        `/v1/identity/x/link/${started.link_id}?code=AAAAAAAAAA`,
      ),
    );
    expect(status.status).toBe("awaiting_x");
    const complete = await request(
      "POST",
      `/v1/identity/x/link/${started.link_id}/complete`,
      { code: "AAAAAAAAAA", signature: "0x00" },
    );
    expect(complete.status).toBe(409);
  });

  test("a cancelled X approval links nothing", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const started = await json<{ link_id: string; authorization_url: string }>(
      await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const state = new URL(started.authorization_url).searchParams.get("state");
    const callback = await request(
      "GET",
      `/v1/identity/x/callback?state=${state}&error=access_denied`,
    );
    expect(await callback.text()).toContain("cancelled");
    const status = await json<Status>(
      await request("GET", `/v1/identity/x/link/${started.link_id}`),
    );
    expect(status.status).toBe("awaiting_x");
  });
});

describe("return_to", () => {
  test("the browser returns to an allowed page with the code", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId, callback } = await approveOnX(
      "1",
      account.address,
      "https://pr-12.interface-9yz.pages.dev/positions/1?tab=owner",
    );
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("location")!);
    expect(location.origin).toBe("https://pr-12.interface-9yz.pages.dev");
    expect(location.searchParams.get("tab")).toBe("owner");
    expect(location.searchParams.get("x_link")).toBe("complete");
    const code = location.searchParams.get("x_link_code")!;
    expect((await messageFor(linkId, code)).x_handle).toBe("alice");
  });

  test("any other origin is refused", async () => {
    for (const returnTo of [
      "https://evil.example/",
      "https://interface-9yz.pages.dev.evil.example/",
      "http://interface-9yz.pages.dev/",
    ]) {
      const response = await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: privateKeyToAccount(generatePrivateKey()).address,
        return_to: returnTo,
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("relink and unlink", () => {
  test("relinking replaces the link and keeps the old one in history", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    xAccount = { id: "42", username: "bob" };
    const { response } = await link("8453", account.address, (td) =>
      signEvm(account, td),
    );
    expect(response.status).toBe(200);
    const address = account.address.toLowerCase();
    expect((await lookup("1", address)).identities[address]?.x_handle).toBe(
      "bob",
    );
    expect(history()).toEqual([
      { address, x_handle: "alice", end_reason: "relinked" },
    ]);
  });

  test("a signed unlink removes the link, once", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const message = await json<{ nonce: string; typed_data: TypedData }>(
      await request("POST", "/v1/identity/x/unlink/message", {
        chain_id: 1,
        address: account.address,
      }),
    );
    expect(message.typed_data.primaryType).toBe("UnlinkXAccount");
    const body = {
      chain_id: "1",
      address: account.address,
      nonce: message.nonce,
      signature: await signEvm(account, message.typed_data),
    };
    const removed = await request("DELETE", "/v1/identity/x/link", body);
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ removed: 1 });
    const address = account.address.toLowerCase();
    expect((await lookup("8453", address)).identities[address]).toBeNull();
    expect(history()).toEqual([
      { address, x_handle: "alice", end_reason: "unlinked" },
    ]);
    expect((await request("DELETE", "/v1/identity/x/link", body)).status).toBe(
      409,
    );
  });

  test("an unlink signed by another key is refused", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const message = await json<{ nonce: string; typed_data: TypedData }>(
      await request("POST", "/v1/identity/x/unlink/message", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const response = await request("DELETE", "/v1/identity/x/link", {
      chain_id: "1",
      address: account.address,
      nonce: message.nonce,
      signature: await signEvm(other, message.typed_data),
    });
    expect(response.status).toBe(401);
  });

  test("an unlink message expires after 10 minutes", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const message = await json<{ nonce: string; typed_data: TypedData }>(
      await request("POST", "/v1/identity/x/unlink/message", {
        chain_id: "1",
        address: account.address,
      }),
    );
    const signature = await signEvm(account, message.typed_data);
    setSystemTime(new Date(Date.now() + 601_000));
    const response = await request("DELETE", "/v1/identity/x/link", {
      chain_id: "1",
      address: account.address,
      nonce: message.nonce,
      signature,
    });
    expect(response.status).toBe(409);
  });

  test("there is nothing to unlink without a link", async () => {
    const response = await request("POST", "/v1/identity/x/unlink/message", {
      chain_id: "1",
      address: privateKeyToAccount(generatePrivateKey()).address,
    });
    expect(response.status).toBe(404);
  });
});

describe("contract accounts", () => {
  const SMART = "0x7a16ff8270133f063aab6c9977183d9e72835428";

  test("an ERC-1271 link holds only on the chain it was verified on", async () => {
    contracts.set(SMART, new Set(["8453"]));
    const { response } = await link("8453", SMART, async () => "0x1234");
    expect(response.status).toBe(200);
    const body = await json<{ identity: Record<string, string> }>(response);
    expect(body.identity).toMatchObject({
      scope: "chain",
      verified_chain_id: "8453",
      signature_kind: "erc1271",
    });
    expect((await lookup("8453", SMART)).identities[SMART]?.x_handle).toBe(
      "alice",
    );
    expect((await lookup("1", SMART)).identities[SMART]).toBeNull();
  });

  test("a contract signature valid on another chain only is refused", async () => {
    contracts.set(SMART, new Set(["8453"]));
    const { response } = await link("1", SMART, async () => "0x1234");
    expect(response.status).toBe(401);
  });

  test("a chain link overrides the namespace link on its chain only", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const address = account.address.toLowerCase();
    await link("1", account.address, (td) => signEvm(account, td));
    contracts.set(address, new Set(["8453"]));
    xAccount = { id: "42", username: "bob" };
    const { response } = await link(
      "8453",
      account.address,
      async () => "0x1234",
    );
    expect(response.status).toBe(200);
    expect((await lookup("8453", address)).identities[address]?.x_handle).toBe(
      "bob",
    );
    expect((await lookup("1", address)).identities[address]?.x_handle).toBe(
      "alice",
    );
  });

  test("an ERC-6492 signature links an undeployed account on its chain", async () => {
    erc6492Valid = true;
    const signature = serializeErc6492Signature({
      address: "0x0000000000000000000000000000000000006492",
      data: "0xdeadbeef",
      signature: "0x1234",
    });
    const { response } = await link("8453", SMART, async () => signature);
    expect(response.status).toBe(200);
    const body = await json<{ identity: Record<string, string> }>(response);
    expect(body.identity).toMatchObject({
      scope: "chain",
      signature_kind: "erc6492",
    });
    const validatorCall = calls.find(
      (c) => c.url === RPC_URLS["8453"] && !c.body.includes('"to"'),
    );
    expect(validatorCall).toBeDefined();
  });

  test("an unreachable chain is a retryable 503, not a refusal", async () => {
    contracts.set(SMART, new Set(["8453"]));
    rpcDown = true;
    const { response } = await link("8453", SMART, async () => "0x1234");
    expect(response.status).toBe(503);
  });

  test("an EOA with a non-matching signature is refused", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { response } = await link(
      "8453",
      account.address,
      async () => "0x1234",
    );
    expect(response.status).toBe(401);
  });
});

describe("Starknet accounts", () => {
  const ACCOUNT =
    "0x4c1d9da136846ab084ae18cf6ce7a652df7793b666a16ce46b1bf5850cc739d";
  const PADDED = `0x0${ACCOUNT.slice(2)}`;

  test("a Starknet account links with is_valid_signature on mainnet only", async () => {
    const { response } = await link(STARKNET, ACCOUNT, async (td) => {
      expect(td.domain).toEqual({
        name: "ekubo.org",
        version: "1",
        chainId: "SN_MAIN",
        revision: "1",
      });
      return ["0x1", "0x2"];
    });
    expect(response.status).toBe(200);
    const body = await json<{
      address: string;
      identity: Record<string, string>;
    }>(response);
    expect(body.address).toBe(PADDED);
    expect(body.identity).toMatchObject({
      scope: "chain",
      signature_kind: "starknet",
    });
    const call = JSON.parse(
      calls.find(
        (c) => c.url === RPC_URLS[STARKNET_MAINNET_CHAIN_ID.toString()],
      )!.body,
    );
    expect(call.method).toBe("starknet_call");
    expect(call.params.request.calldata.slice(1)).toEqual([
      "0x2",
      "0x1",
      "0x2",
    ]);
    expect((await lookup(STARKNET, ACCOUNT)).identities[PADDED]?.x_handle).toBe(
      "alice",
    );
  });

  test("an invalid Starknet signature is refused", async () => {
    starknetResult = ["0x0"];
    const { response } = await link(STARKNET, ACCOUNT, async () => [
      "0x1",
      "0x2",
    ]);
    expect(response.status).toBe(401);
  });

  test("an undeployed Starknet account is refused", async () => {
    starknetResult = "error";
    const { response } = await link(STARKNET, ACCOUNT, async () => [
      "0x1",
      "0x2",
    ]);
    expect(response.status).toBe(401);
  });
});

describe("guards", () => {
  test("rate limits answer 429", async () => {
    limited = true;
    const response = await request("POST", "/v1/identity/x/link/start", {
      chain_id: "1",
      address: privateKeyToAccount(generatePrivateKey()).address,
    });
    expect(response.status).toBe(429);
  });

  test("Elysium is not supported: Alchemy does not serve it", async () => {
    const response = await request("POST", "/v1/identity/x/link/start", {
      chain_id: "99901",
      address: privateKeyToAccount(generatePrivateKey()).address,
    });
    expect(response.status).toBe(400);
  });

  test("unsupported chains and malformed addresses are 400", async () => {
    for (const body of [
      {
        chain_id: "999",
        address: "0x7a16ff8270133f063aab6c9977183d9e72835428",
      },
      { chain_id: "1", address: "0x1234" },
      { chain_id: STARKNET, address: `0x${"f".repeat(64)}` },
    ]) {
      expect(
        (await request("POST", "/v1/identity/x/link/start", body)).status,
      ).toBe(400);
    }
  });

  test("lookups are cached briefly and capped at 100 addresses", async () => {
    const response = await request(
      "GET",
      "/v1/identity/addresses?chainId=1&address=0x7a16ff8270133f063aab6c9977183d9e72835428",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=30",
    );
    const many = Array.from(
      { length: 101 },
      (_, i) => `address=0x${i.toString(16).padStart(40, "0")}`,
    ).join("&");
    expect(
      (await request("GET", `/v1/identity/addresses?chainId=1&${many}`)).status,
    ).toBe(400);
  });
});

interface XUnlinkResult {
  x_user_id: string;
  x_handle: string;
  removed: { address: string; scope: string; verified_chain_id: string }[];
}

async function signInForUnlink(returnTo?: string) {
  const started = await request("POST", "/v1/identity/x/unlink/start", {
    return_to: returnTo,
  });
  expect(started.status).toBe(200);
  const { unlink_id, authorization_url } = await json<{
    unlink_id: string;
    authorization_url: string;
  }>(started);
  const state = new URL(authorization_url).searchParams.get("state")!;
  const callback = await request(
    "GET",
    `/v1/identity/x/callback?state=${state}&code=oauth-code`,
  );
  return { unlinkId: unlink_id, callback };
}

function completeUnlink(unlinkId: string, code: string) {
  return request("POST", `/v1/identity/x/unlink/${unlinkId}/complete`, {
    code,
  });
}

async function unlinkFromX(): Promise<XUnlinkResult> {
  const { unlinkId, callback } = await signInForUnlink();
  const response = await completeUnlink(unlinkId, await codeFromPage(callback));
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(
    XUnlinkCompleteResponseType.strict().safeParse(body).error,
  ).toBeUndefined();
  return body as unknown as XUnlinkResult;
}

describe("unlinking from the X side", () => {
  const SMART = "0x7a16ff8270133f063aab6c9977183d9e72835428";

  test("removes only that X account's links, on every chain, into history", async () => {
    const mine = privateKeyToAccount(generatePrivateKey());
    await link("1", mine.address, (td) => signEvm(mine, td));
    contracts.set(SMART, new Set(["8453"]));
    await link("8453", SMART, async () => "0x1234");
    xAccount = { id: "42", username: "bob" };
    const theirs = privateKeyToAccount(generatePrivateKey());
    await link("1", theirs.address, (td) => signEvm(theirs, td));

    xAccount = { id: "1234567890", username: "alice_renamed" };
    const result = await unlinkFromX();
    const address = mine.address.toLowerCase();
    expect(result.x_user_id).toBe("1234567890");
    expect(result.x_handle).toBe("alice_renamed");
    expect(
      result.removed.toSorted((a, b) => a.address.localeCompare(b.address)),
    ).toEqual(
      [
        { address, scope: "namespace", verified_chain_id: "1" },
        { address: SMART, scope: "chain", verified_chain_id: "8453" },
      ].toSorted((a, b) => a.address.localeCompare(b.address)),
    );
    for (const chain of ["1", "8453"]) {
      const { identities } = await lookup(chain, address, SMART);
      expect(identities[address]).toBeNull();
      expect(identities[SMART]).toBeNull();
    }
    const other = theirs.address.toLowerCase();
    expect((await lookup("1", other)).identities[other]?.x_handle).toBe("bob");
    expect(
      sqlite
        .prepare(
          "SELECT address, x_user_id, end_reason FROM link_history ORDER BY address",
        )
        .all(),
    ).toEqual(
      [
        { address, x_user_id: "1234567890", end_reason: "x_unlinked" },
        { address: SMART, x_user_id: "1234567890", end_reason: "x_unlinked" },
      ].toSorted((a, b) => a.address.localeCompare(b.address)),
    );
  });

  test("a sign-in as another X account removes nothing", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    xAccount = { id: "42", username: "bob" };
    expect((await unlinkFromX()).removed).toEqual([]);
    const address = account.address.toLowerCase();
    expect((await lookup("1", address)).identities[address]?.x_handle).toBe(
      "alice",
    );
    expect(history()).toEqual([]);
  });

  test("the callback alone removes nothing, and five wrong codes discard the unlink", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const { unlinkId, callback } = await signInForUnlink();
    const html = await callback.text();
    expect(html).toContain("@alice");
    expect(html).toContain("nothing is removed without this code");
    const address = account.address.toLowerCase();
    expect((await lookup("1", address)).identities[address]?.x_handle).toBe(
      "alice",
    );
    for (let i = 0; i < 5; i++) {
      expect((await completeUnlink(unlinkId, "AAAAAAAAAA")).status).toBe(403);
    }
    expect((await completeUnlink(unlinkId, "AAAAAAAAAA")).status).toBe(404);
    expect((await lookup("1", address)).identities[address]?.x_handle).toBe(
      "alice",
    );
  });

  test("an unlink completes once, and not before X sign-in", async () => {
    const started = await json<{ unlink_id: string }>(
      await request("POST", "/v1/identity/x/unlink/start", {}),
    );
    expect((await completeUnlink(started.unlink_id, "AAAAAAAAAA")).status).toBe(
      409,
    );
    const { unlinkId, callback } = await signInForUnlink();
    const code = await codeFromPage(callback);
    expect((await completeUnlink(unlinkId, code)).status).toBe(200);
    expect((await completeUnlink(unlinkId, code)).status).toBe(404);
  });

  test("it discards links to the account still in progress", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { linkId, callback } = await approveOnX("1", account.address);
    const code = await codeFromPage(callback);
    const status = await messageFor(linkId, code);
    const signature = await signEvm(account, status.typed_data!);
    await unlinkFromX();
    const late = await request(
      "POST",
      `/v1/identity/x/link/${linkId}/complete`,
      { code, signature },
    );
    expect(late.status).toBe(404);
  });

  test("the browser returns to an allowed page with x_unlink and its code", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    const { unlinkId, callback } = await signInForUnlink(
      `${RETURN_ORIGIN}/settings`,
    );
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("location")!);
    expect(location.origin).toBe(RETURN_ORIGIN);
    expect(location.searchParams.get("x_unlink")).toBe("complete");
    expect(location.searchParams.get("x_link")).toBeNull();
    const code = location.searchParams.get("x_unlink_code")!;
    expect((await completeUnlink(unlinkId, code)).status).toBe(200);
    expect(
      (
        await request("POST", "/v1/identity/x/unlink/start", {
          return_to: "https://evil.example/",
        })
      ).status,
    ).toBe(400);
  });
});

describe("security review regressions", () => {
  test("unlink still works after ten start calls for the address from another IP", async () => {
    const counts = new Map<string, number>();
    const counting: RateLimit = {
      limit: async ({ key }) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return { success: counts.get(key)! <= 10 };
      },
    };
    const account = privateKeyToAccount(generatePrivateKey());
    await link("1", account.address, (td) => signEvm(account, td));
    env = { ...env, IDENTITY_ADDRESS_LIMITER: counting };
    for (let i = 0; i < 11; i++) {
      await request(
        "POST",
        "/v1/identity/x/link/start",
        { chain_id: "1", address: account.address },
        "198.51.100.9",
      );
    }
    const message = await request("POST", "/v1/identity/x/unlink/message", {
      chain_id: "1",
      address: account.address,
    });
    expect(message.status).toBe(200);
    const { nonce, typed_data } = await json<{
      nonce: string;
      typed_data: TypedData;
    }>(message);
    const removed = await request("DELETE", "/v1/identity/x/link", {
      chain_id: "1",
      address: account.address,
      nonce,
      signature: await signEvm(account, typed_data),
    });
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ removed: 1 });
  });

  test("an ERC-1271 magic value followed by non-zero bytes is refused", async () => {
    const precompile = "0x0000000000000000000000000000000000000002";
    rawReturns.set(precompile, `0x1626ba7e${"ab".repeat(28)}`);
    const { response } = await link("8453", precompile, async () => "0x1234");
    expect(response.status).toBe(401);
    rawReturns.set(precompile, `0x1626ba7e${"0".repeat(56)}`);
    const exact = await link("8453", precompile, async () => "0x1234");
    expect(exact.response.status).toBe(200);
  });

  test("a missing limiter binding answers 503 instead of running unlimited", async () => {
    for (const missing of [
      "IDENTITY_IP_LIMITER",
      "IDENTITY_ADDRESS_LIMITER",
    ] as const) {
      const saved = env;
      env = { ...env, [missing]: undefined };
      const response = await request("POST", "/v1/identity/x/link/start", {
        chain_id: "1",
        address: privateKeyToAccount(generatePrivateKey()).address,
      });
      expect(response.status).toBe(503);
      expect(
        (await request("POST", "/v1/identity/x/unlink/start", {})).status,
      ).toBe(503);
      env = saved;
    }
  });

  test("a contract-signature unlink of an all-chain link is refused and keeps its nonce", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const address = account.address.toLowerCase();
    await link("1", account.address, (td) => signEvm(account, td));
    contracts.set(address, new Set(["8453"]));
    const message = await json<{ nonce: string; typed_data: TypedData }>(
      await request("POST", "/v1/identity/x/unlink/message", {
        chain_id: "8453",
        address,
      }),
    );
    const body = {
      chain_id: "8453",
      address,
      nonce: message.nonce,
      signature: "0x1234",
    };
    const refused = await request("DELETE", "/v1/identity/x/link", body);
    expect(refused.status).toBe(409);
    expect((await json<{ error: string }>(refused)).error).toContain("own key");
    expect((await lookup("8453", address)).identities[address]?.x_handle).toBe(
      "alice",
    );
    const removed = await request("DELETE", "/v1/identity/x/link", {
      ...body,
      signature: await signEvm(account, message.typed_data),
    });
    expect(await json(removed)).toEqual({ removed: 1 });
  });
});
