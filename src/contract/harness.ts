import { spyOn } from "bun:test";
import { z } from "@hono/zod-openapi";
import { Env } from "../env";
import { Queries, type RawErc20TokenRow } from "../queries";
import { app, openApiDocument } from "../router";

type QueryName = {
  [K in keyof Queries]: Queries[K] extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof Queries];

type Rows<T> = T extends readonly (infer R)[] ? R[] : T;
type Fixture<T> = T extends readonly unknown[]
  ? Rows<T>
  : T extends { rows: infer R }
    ? Omit<T, "rows"> & { rows: Rows<R> }
    : T;

export type QueryResult<K extends QueryName> = Fixture<
  Awaited<ReturnType<Queries[K]>>
>;

export interface ContractCase {
  readonly operation: string;
  readonly request: string;
  readonly stub?: () => void;
  readonly name?: string;
  readonly contentType?: string;
  readonly knownDrift?: string;
}

export const env: Env = {
  PG_CONNECTION_STRING: "postgres://contract:contract@127.0.0.1:1/contract",
};

export function stubQuery<K extends QueryName>(
  name: K,
  result: QueryResult<K>,
): void {
  spyOn(Queries.prototype, name).mockImplementation((() =>
    Promise.resolve(result)) as never);
}

export function stubTokens(rows: RawErc20TokenRow[]): void {
  spyOn(Queries.prototype, "getErc20TokenByAddress").mockImplementation(
    async ({ tokenAddress }) =>
      rows.find((row) => BigInt(row.token_address) === tokenAddress) ?? null,
  );
}

export function stubAllQueriesToThrow(): void {
  const realFetch = globalThis.fetch;
  spyOn(globalThis, "fetch").mockImplementation(((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("data:")) return realFetch(input, init);
    throw new Error(`Unexpected fetch in a contract case: ${url}`);
  }) as typeof fetch);
  for (const name of Object.getOwnPropertyNames(Queries.prototype)) {
    if (name === "constructor") continue;
    spyOn(Queries.prototype, name as QueryName).mockImplementation(() => {
      throw new Error(`Query "${name}" is not stubbed for this contract case`);
    });
  }
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

function closeObjects(schema: JsonSchema): JsonSchema {
  const closed: JsonSchema = { ...schema };
  if (closed.properties !== undefined) {
    closed.properties = Object.fromEntries(
      Object.entries(closed.properties).map(([key, value]) => [
        key,
        closeObjects(value),
      ]),
    );
    closed.additionalProperties ??= false;
  }
  if (typeof closed.additionalProperties === "object") {
    closed.additionalProperties = closeObjects(closed.additionalProperties);
  }
  if (closed.items !== undefined) closed.items = closeObjects(closed.items);
  if (closed.anyOf !== undefined) closed.anyOf = closed.anyOf.map(closeObjects);
  return closed;
}

type Operation = {
  responses: Record<
    string,
    { content?: Record<string, { schema?: JsonSchema }> }
  >;
};

export function operations(): Record<string, Operation> {
  const paths = openApiDocument().paths as Record<string, { get?: Operation }>;
  return Object.fromEntries(
    Object.entries(paths).flatMap(([path, item]) =>
      item.get === undefined ? [] : [[path, item.get]],
    ),
  );
}

export function responseSchema(operation: string): z.ZodType | null {
  const schema =
    operations()[operation]?.responses["200"]?.content?.["application/json"]
      ?.schema;
  return schema === undefined
    ? null
    : z.fromJSONSchema(closeObjects(schema) as z.core.JSONSchema.JSONSchema);
}

export async function fetchRoute(path: string): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`), env);
}
