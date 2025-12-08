import { z } from "zod";

export const ErrorResponseType = z
  .object({
    status: z
      .number({
        description: "HTTP status code for the error",
      })
      .int(),
    error: z.string({
      description: "Human-readable description of the error",
    }),
  })
  .required({
    status: true,
    error: true,
  })
  .passthrough()
  .openapi({
    description: "Standard error response payload",
    example: {
      status: 404,
      error: "Token not found",
    },
  });

export type ErrorResponse = z.infer<typeof ErrorResponseType>;
