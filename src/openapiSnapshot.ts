import { openApiDocument } from "./router";

export const OPENAPI_SNAPSHOT_URL = new URL("../openapi.json", import.meta.url);

export function serializeOpenApiSchema(): string {
  return `${JSON.stringify(openApiDocument(), null, 2)}\n`;
}
