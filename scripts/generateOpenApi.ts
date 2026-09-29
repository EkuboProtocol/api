import {
  OPENAPI_SNAPSHOT_URL,
  serializeOpenApiSchema,
} from "../src/openapiSnapshot";

await Bun.write(OPENAPI_SNAPSHOT_URL, serializeOpenApiSchema());
console.log(`Wrote ${OPENAPI_SNAPSHOT_URL.pathname}`);
