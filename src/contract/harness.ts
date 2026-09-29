import { spyOn } from "bun:test";
import { json } from "itty-router";
import { z } from "zod";
import { Env } from "../env";
import { Queries, type RawErc20TokenRow } from "../queries";
import { router } from "../router";

type QueryName = {
  [K in keyof Queries]: Queries[K] extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof Queries];

// postgres types a query's rows as a RowList (the rows plus result metadata
// such as count and columns). Routes only read the rows, so fixtures are plain
// arrays, both at the top level and under a paginated result's `rows`.
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
  // OpenAPI path template, e.g. "/blocks/{chainId}/{blockTag}".
  readonly operation: string;
  // Concrete request path (and query string) to send through the router.
  readonly request: string;
  // Stubs the queries the route needs; unstubbed queries throw.
  readonly stub?: () => void;
  readonly name?: string;
  // For operations without a JSON 200 schema (SVG images, raw NFT metadata),
  // the content type the response must carry instead.
  readonly contentType?: string;
  // A real mismatch between the handler and its published schema, recorded
  // rather than fixed here. The case must keep failing; once the drift is
  // fixed the runner reports it and the entry has to be removed.
  readonly knownDrift?: string;
}

// Routes must still build a Queries instance, but postgres connects lazily and
// every query method is stubbed, so this address is never dialled.
export const env: Env = {
  PG_CONNECTION_STRING: "postgres://contract:contract@127.0.0.1:1/contract",
};

export function stubQuery<K extends QueryName>(
  name: K,
  result: QueryResult<K>,
): void {
  // The routes only await query results, so a plain promise stands in for
  // postgres' PendingQuery.
  spyOn(Queries.prototype, name).mockImplementation((() =>
    Promise.resolve(result)) as never);
}

// getErc20TokenByAddress runs once per token, so answer by address rather than
// with one fixed row (which would, for example, make tokenA equal tokenB).
export function stubTokens(rows: RawErc20TokenRow[]): void {
  spyOn(Queries.prototype, "getErc20TokenByAddress").mockImplementation(
    async ({ tokenAddress }) =>
      rows.find((row) => BigInt(row.token_address) === tokenAddress) ?? null,
  );
}

export function stubAllQueriesToThrow(): void {
  // Fixtures must be self-contained (token logos are data: URLs), so any
  // other network access is a bug in the case.
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

// zod-to-openapi leaves additionalProperties unset, which would let
// undocumented response fields through. Close every object that lists its
// properties so the check also catches fields missing from the schema.
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
  const paths = router.schema.paths as Record<string, { get?: Operation }>;
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
  const result: unknown = await router.fetch(
    new Request(`http://localhost${path}`),
    { env },
  );
  return result instanceof Response ? result : json(result);
}
