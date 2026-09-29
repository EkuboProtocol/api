import { expect, test } from "bun:test";
import {
  OPENAPI_SNAPSHOT_URL,
  serializeOpenApiSchema,
} from "./openapiSnapshot";

test("openapi.json matches the app's OpenAPI document (run `bun run openapi` to regenerate)", async () => {
  expect(serializeOpenApiSchema()).toBe(
    await Bun.file(OPENAPI_SNAPSHOT_URL).text(),
  );
});
