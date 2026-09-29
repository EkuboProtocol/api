import { describe, expect, test } from "bun:test";
import { Env } from "./env";
import { app, openApiDocument } from "./router";

const fetchPath = (path: string) =>
  app.fetch(new Request(`http://localhost${path}`), {} as Env);

describe("Hono app integration", () => {
  test("registers every API route and its parameters", () => {
    const schema = openApiDocument();
    const paths = schema.paths as Record<string, Record<string, unknown>>;
    const operations = Object.values(paths).flatMap((path) =>
      Object.values(path).filter(
        (
          operation,
        ): operation is {
          parameters?: unknown[];
          responses: Record<string, { content?: Record<string, unknown> }>;
        } =>
          operation !== null &&
          typeof operation === "object" &&
          "responses" in operation,
      ),
    );

    expect(Object.keys(schema.paths ?? {})).toHaveLength(58);
    expect(operations).toHaveLength(58);
    expect(
      operations.reduce(
        (count, operation) => count + (operation.parameters?.length ?? 0),
        0,
      ),
    ).toBe(196);

    const getToken = operations.find(
      (operation) =>
        operation === paths["/tokens/{chainId}/{tokenAddress}"]?.get,
    );
    expect(
      getToken?.responses["200"].content?.["application/json"],
    ).toBeDefined();
    expect(
      getToken?.responses["404"].content?.["application/json"],
    ).toBeDefined();

    const getTokenPriceHistory = operations.find(
      (operation) =>
        operation ===
        paths["/tokens/{chainId}/{tokenAddress}/price-history"]?.get,
    );
    expect(
      getTokenPriceHistory?.responses["200"].content?.["application/json"],
    ).toBeDefined();
  });

  test("documents total and ve33 component fees in stats responses", () => {
    type JsonSchema = {
      properties?: Record<string, JsonSchema>;
      items?: JsonSchema;
      required?: string[];
    };
    type GetOperation = {
      responses: Record<
        string,
        { content?: Record<string, { schema?: JsonSchema }> }
      >;
    };

    const paths = openApiDocument().paths as Record<
      string,
      { get?: GetOperation }
    >;
    const responseSchema = (path: string) =>
      paths[path]?.get?.responses["200"].content?.["application/json"].schema;
    const requiredEntryFields = (path: string, property: string) =>
      responseSchema(path)?.properties?.[property].items?.required;

    const volumeFields = ["fees", "ve33_fees"];
    expect(
      requiredEntryFields("/overview/volume", "volumeByToken_24h"),
    ).toEqual(expect.arrayContaining(volumeFields));
    expect(
      requiredEntryFields(
        "/pair/{chainId}/{tokenA}/{tokenB}/volume",
        "volumeByTokenByDate",
      ),
    ).toEqual(expect.arrayContaining(volumeFields));

    const poolFeeFields = [
      "fees0_24h",
      "fees1_24h",
      "ve33_fees0_24h",
      "ve33_fees1_24h",
    ];
    expect(requiredEntryFields("/overview/pairs", "topPairs")).toEqual(
      expect.arrayContaining(poolFeeFields),
    );
    expect(
      requiredEntryFields("/overview/boosted-fees-pools", "pools"),
    ).toEqual(expect.arrayContaining(poolFeeFields));
    expect(
      requiredEntryFields(
        "/pair/{chainId}/{tokenA}/{tokenB}/pools",
        "topPools",
      ),
    ).toEqual(expect.arrayContaining(poolFeeFields));
    expect(requiredEntryFields("/ve33/{ve33Address}/pools", "data")).toEqual(
      expect.arrayContaining(poolFeeFields),
    );
    expect(requiredEntryFields("/ve33/{ve33Address}/pools", "data")).toEqual(
      expect.arrayContaining([
        "ve33_fees0_7d",
        "ve33_fees1_7d",
        "ve33_fees0_all",
        "ve33_fees1_all",
        "ve33_fees_since",
      ]),
    );

    expect(requiredEntryFields("/ve33/{ve33Address}/voters", "data")).toEqual(
      expect.arrayContaining(["voter", "total_vote_weight"]),
    );
    expect(responseSchema("/ve33/{ve33Address}/voters")?.required).toEqual(
      expect.arrayContaining(["data", "total_vote_weight", "pagination"]),
    );
  });

  test("validates requests before invoking route handlers", async () => {
    const response = await fetchPath("/tokens?pageSize=0");

    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toEqual({
      status: 400,
      error: "Invalid query: pageSize: Too small: expected number to be >=1",
    });

    const positionEventsResponse = await fetchPath(
      "/positions/1/events?limit=0",
    );

    expect(positionEventsResponse.status).toBe(400);

    const tokenPriceHistoryResponse = await fetchPath(
      "/tokens/1/0x1/price-history?interval=59",
    );

    expect(tokenPriceHistoryResponse.status).toBe(400);

    const invalidVotersPageResponse = await fetchPath(
      "/ve33/0x1/voters?chainId=1&page=2",
    );

    expect(invalidVotersPageResponse.status).toBe(400);

    expect(
      (
        await fetchPath(
          "/tokens/1/0x1/price-history?interval=60&duration=86400",
        )
      ).status,
    ).toBe(400);
  });

  test("validates pool key discovery requests without a database", async () => {
    const sameTokens = await fetchPath("/poolKeys/1/0x1?tokenA=0x2&tokenB=0x2");
    expect(sameTokens.status).toBe(400);
    // Errors thrown by handlers keep the { status, error } body.
    expect((await sameTokens.json()) as unknown).toMatchObject({
      status: 400,
      error: expect.any(String),
    });

    expect((await fetchPath("/poolKeys/1/0x1?tokenB=0x2")).status).toBe(400);

    expect(
      (await fetchPath(`/poolKeys/1/0x1?tokenA=0x${"f".repeat(42)}`)).status,
    ).toBe(400);

    for (const path of [
      `/poolKeys/1/0x${"f".repeat(42)}`,
      `/poolKeys/1/0x${"f".repeat(42)}/0x1`,
    ]) {
      expect((await fetchPath(path)).status).toBe(400);
    }

    const badLimit = await fetchPath("/poolKeys/1/0x1?limit=201");
    expect(badLimit.status).toBe(400);

    const badCursor = await fetchPath("/poolKeys/1/0x1?after=not-a-number");
    expect(badCursor.status).toBe(400);
  });

  test("continues to serve ordinary and fallback routes", async () => {
    const countryResponse = await fetchPath("/country");
    expect(countryResponse.status).toBe(200);
    expect((await countryResponse.json()) as unknown).toEqual({
      country: null,
    });

    const missingResponse = await fetchPath("/not-a-route");
    expect(missingResponse.status).toBe(404);
    expect((await missingResponse.json()) as unknown).toEqual({
      status: 404,
      error: "Not Found",
    });

    const openApiResponse = await fetchPath("/openapi.json");
    expect(openApiResponse.status).toBe(200);
    expect((await openApiResponse.json()) as unknown).toEqual(
      JSON.parse(JSON.stringify(openApiDocument())),
    );
  });

  test("serves an empty terminal position event page without a database", async () => {
    const response = await fetchPath(
      "/positions/1/events?cursor=9223372036854775807",
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({
      chain_id: "1",
      events: [],
      next_cursor: "9223372036854775807",
      has_more: false,
    });
  });
});
