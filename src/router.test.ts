import { describe, expect, test } from "bun:test";
import { Env } from "./env";
import { router } from "./router";

const context = { env: {} as Env };

describe("Chanfana router integration", () => {
  test("registers every API route and its parameters", () => {
    const schema = router.schema;
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

    expect(Object.keys(schema.paths)).toHaveLength(56);
    expect(operations).toHaveLength(56);
    expect(
      operations.reduce(
        (count, operation) => count + (operation.parameters?.length ?? 0),
        0,
      ),
    ).toBe(185);

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

    const paths = router.schema.paths as Record<string, { get?: GetOperation }>;
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
    const response = await router.fetch(
      new Request("http://localhost/tokens?pageSize=0"),
      context,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      errors: [
        {
          code: 7001,
          message: "Too small: expected number to be >=1",
          path: ["query", "pageSize"],
        },
      ],
      result: {},
    });

    const positionEventsResponse = await router.fetch(
      new Request("http://localhost/positions/1/events?limit=0"),
      context,
    );

    expect(positionEventsResponse.status).toBe(400);

    const tokenPriceHistoryResponse = await router.fetch(
      new Request("http://localhost/tokens/1/0x1/price-history?interval=59"),
      context,
    );

    expect(tokenPriceHistoryResponse.status).toBe(400);

    const invalidVotersPageResponse = await router.fetch(
      new Request("http://localhost/ve33/0x1/voters?chainId=1&page=2"),
      context,
    );

    expect(invalidVotersPageResponse.status).toBe(400);

    await expect(
      router.fetch(
        new Request(
          "http://localhost/tokens/1/0x1/price-history?interval=60&duration=86400",
        ),
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("validates pool key discovery requests without a database", async () => {
    await expect(
      router.fetch(
        new Request("http://localhost/poolKeys/1/0x1?tokenA=0x2&tokenB=0x2"),
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      router.fetch(
        new Request("http://localhost/poolKeys/1/0x1?tokenB=0x2"),
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      router.fetch(
        new Request(`http://localhost/poolKeys/1/0x1?tokenA=0x${"f".repeat(42)}`),
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });

    for (const path of [
      `/poolKeys/1/0x${"f".repeat(42)}`,
      `/poolKeys/1/0x${"f".repeat(42)}/0x1`,
    ]) {
      await expect(
        router.fetch(new Request(`http://localhost${path}`), context),
      ).rejects.toMatchObject({ status: 400 });
    }

    const badLimit = await router.fetch(
      new Request("http://localhost/poolKeys/1/0x1?limit=201"),
      context,
    );
    expect(badLimit.status).toBe(400);

    const badCursor = await router.fetch(
      new Request("http://localhost/poolKeys/1/0x1?after=not-a-number"),
      context,
    );
    expect(badCursor.status).toBe(400);
  });

  test("continues to serve ordinary and fallback routes", async () => {
    const countryResponse = await router.fetch(
      new Request("http://localhost/country"),
      context,
    );
    expect(countryResponse.status).toBe(200);
    expect(await countryResponse.json()).toEqual({ country: null });

    const missingResponse = await router.fetch(
      new Request("http://localhost/not-a-route"),
      context,
    );
    expect(missingResponse.status).toBe(404);
  });

  test("serves an empty terminal position event page without a database", async () => {
    const response = await router.fetch(
      new Request(
        "http://localhost/positions/1/events?cursor=9223372036854775807",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chain_id: "1",
      events: [],
      next_cursor: "9223372036854775807",
      has_more: false,
    });
  });
});
