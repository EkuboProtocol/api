import { openApiDocument } from "./router";

export const OPENAPI_SNAPSHOT_URL = new URL("../openapi.json", import.meta.url);

// The committed openapi.json is the public contract: openapiSnapshot.test.ts
// fails whenever the app's OpenAPI document drifts from it.
export function serializeOpenApiSchema(): string {
  return `${JSON.stringify(openApiDocument(), null, 2)}\n`;
}
