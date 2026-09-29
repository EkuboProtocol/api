import { router } from "./router";

export const OPENAPI_SNAPSHOT_URL = new URL("../openapi.json", import.meta.url);

// The committed openapi.json is the public contract: openapiSnapshot.test.ts
// fails whenever the router's schema drifts from it.
export function serializeOpenApiSchema(): string {
  return `${JSON.stringify(router.schema, null, 2)}\n`;
}
