import { z } from "zod";

export const ErrorResponseType = z
  .looseObject({
    status: z.number().describe("HTTP status code for the error").int(),
    error: z.string().describe("Human-readable description of the error"),
  })
  .required({
    status: true,
    error: true,
  })
  .openapi({
    description: "Standard error response payload",
    example: {
      status: 404,
      error: "Token not found",
    },
  });

export type ErrorResponse = z.infer<typeof ErrorResponseType>;
