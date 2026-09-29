import { z } from "@hono/zod-openapi";

// A 200 response whose body is JSON matching `schema`.
export function jsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

// A repeatable query parameter (?id=a&id=b). Hono passes a lone value as a
// string rather than a one-element array, so wrap it before validating.
export function queryArray<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item),
  );
}
