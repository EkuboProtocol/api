import { z } from "zod";

const typeProto = z.ZodType.prototype as { openapi?: (...args: unknown[]) => unknown };

if (!typeProto.openapi) {
  typeProto.openapi = function openapiShim() {
    return this;
  };
}
