import { describe, expect, it } from "bun:test";
import { openApiDocument } from "./router";
import { NUMERIC_QUERY_PARAMS } from "./worker";

type Schema = {
  type?: string | string[];
  pattern?: string;
  maxLength?: number;
  enum?: unknown[];
  anyOf?: Schema[];
  items?: Schema;
};

type Parameter = { name: string; in: string; schema?: Schema };

const INTEGER_PATTERNS = new Set(["^0x[a-fA-F0-9]+$", "^\\d+$"]);
const NUMERICISH = /^(?:0x[0-9a-fA-F]+|[+-]?\d+)$/;

function isIntegerSchema(schema: Schema | undefined): boolean {
  if (!schema) return false;
  if (schema.anyOf) return schema.anyOf.every(isIntegerSchema);
  const types = [schema.type].flat().filter((t) => t !== "null");
  if (types.length !== 1) return false;
  if (types[0] === "integer") return true;
  if (types[0] === "array") return isIntegerSchema(schema.items);
  return (
    types[0] === "string" &&
    schema.pattern !== undefined &&
    INTEGER_PATTERNS.has(schema.pattern)
  );
}

function isPathSafeSchema(schema: Schema | undefined): boolean {
  if (!schema) return false;
  if (schema.anyOf) return schema.anyOf.every(isPathSafeSchema);
  if (isIntegerSchema(schema)) return true;
  return (
    Array.isArray(schema.enum) &&
    schema.enum.every((v) => typeof v === "string" && !NUMERICISH.test(v))
  );
}

function parameters(location: string): { route: string; param: Parameter }[] {
  const document = openApiDocument() as unknown as {
    paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
  };
  return Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.entries(operations).flatMap(([method, operation]) =>
      (operation.parameters ?? [])
        .filter((param) => param.in === location)
        .map((param) => ({ route: `${method.toUpperCase()} ${path}`, param })),
    ),
  );
}

describe("cache key normalization contract", () => {
  it("folds only query parameters that are integers on every route", () => {
    const unsafe = parameters("query")
      .filter(({ param }) => NUMERIC_QUERY_PARAMS.has(param.name))
      .filter(({ param }) => !isIntegerSchema(param.schema))
      .map(({ route, param }) => `${route} ?${param.name}`);
    expect(unsafe).toEqual([]);
  });

  it("lists only query parameters that some route declares", () => {
    const declared = new Set(
      parameters("query").map(({ param }) => param.name),
    );
    expect([...NUMERIC_QUERY_PARAMS].filter((n) => !declared.has(n))).toEqual(
      [],
    );
  });

  it("has no path parameters that integer folding would corrupt", () => {
    const unsafe = parameters("path")
      .filter(({ param }) => !isPathSafeSchema(param.schema))
      .map(({ route, param }) => `${route} {${param.name}}`);
    expect(unsafe).toEqual([]);
  });

  it("detects free-text parameters", () => {
    expect(isIntegerSchema({ type: "string", maxLength: 32 })).toBe(false);
    expect(isPathSafeSchema({ type: "string" })).toBe(false);
    expect(isPathSafeSchema({ type: "string", enum: ["latest", "1"] })).toBe(
      false,
    );
  });
});
