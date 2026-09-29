import { z } from "@hono/zod-openapi";

export const ErrorResponseType = z
  .object({
    status: z.number().describe("HTTP status code for the error").int(),
    error: z.string().describe("Human-readable description of the error"),
  })
  .openapi("ErrorResponse", {
    description: "Standard error response payload",
    example: {
      status: 404,
      error: "Token not found",
    },
  });

export type ErrorResponse = z.infer<typeof ErrorResponseType>;

// Thrown by handlers and helpers for any non-200 outcome; the app's error
// handler turns it into an ErrorResponse body with the same status.
export class StatusError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ERROR_DESCRIPTIONS = {
  400: "The request parameters are invalid",
  404: "The requested resource was not found",
  500: "An unexpected server error occurred",
} as const;

function errorResponse(status: keyof typeof ERROR_DESCRIPTIONS) {
  return {
    description: ERROR_DESCRIPTIONS[status],
    content: { "application/json": { schema: ErrorResponseType } },
  };
}

// Every route can answer 400 (parameter validation) and 500; routes that look
// something up also declare 404.
export const errorResponses = {
  400: errorResponse(400),
  500: errorResponse(500),
} as const;

export const notFoundResponse = { 404: errorResponse(404) } as const;
