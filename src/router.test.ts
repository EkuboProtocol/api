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

    expect(Object.keys(schema.paths)).toHaveLength(51);
    expect(operations).toHaveLength(51);
    expect(
      operations.reduce(
        (count, operation) => count + (operation.parameters?.length ?? 0),
        0,
      ),
    ).toBe(162);

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
});
