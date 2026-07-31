import type {
  OpenAPIRouteSchema as ChanfanaOpenAPIRouteSchema,
  RequestTypes,
  ResponseConfig,
} from "chanfana";
import { z } from "zod";

interface ParameterOptions {
  default?: unknown;
  description?: string;
  example?: unknown;
  format?: string;
  required?: boolean;
}

interface ParameterDefinition {
  location: "params" | "query";
  options: ParameterOptions;
  type: z.ZodType | z.ZodType[];
}

type LegacyResponseConfig = Omit<ResponseConfig, "content"> & {
  content?: ResponseConfig["content"];
  contentType?: string;
  schema?: z.ZodType;
};

export type OpenAPIRouteSchema = Omit<
  ChanfanaOpenAPIRouteSchema,
  "parameters" | "request" | "responses"
> & {
  parameters?: Record<string, ParameterDefinition>;
  request?: RequestTypes;
  responses?: Record<string, LegacyResponseConfig>;
};

function parameter(
  location: ParameterDefinition["location"],
  type: ParameterDefinition["type"],
  options: ParameterOptions = {},
): ParameterDefinition {
  return { location, options, type };
}

export function Path(
  type: ParameterDefinition["type"],
  options?: ParameterOptions,
): ParameterDefinition {
  return parameter("params", type, options);
}

export function Query(
  type: ParameterDefinition["type"],
  options?: ParameterOptions,
): ParameterDefinition {
  return parameter("query", type, options);
}

function parameterSchema({ options, type }: ParameterDefinition): z.ZodType {
  let schema = Array.isArray(type) ? type[0].array() : type;

  if (options.required === false) {
    schema = schema.optional();
  }
  if (options.description !== undefined) {
    schema = schema.describe(options.description);
  }
  if (options.default !== undefined) {
    schema = schema.default(options.default);
  }
  if (options.example !== undefined || options.format !== undefined) {
    schema = schema.openapi({
      ...(options.example === undefined ? {} : { example: options.example }),
      ...(options.format === undefined ? {} : { format: options.format }),
    });
  }

  return schema;
}

export function toChanfanaSchema(
  schema: OpenAPIRouteSchema,
): ChanfanaOpenAPIRouteSchema {
  const {
    parameters,
    responses: legacyResponses,
    request: existingRequest,
    ...rest
  } = schema;
  const request: RequestTypes = { ...existingRequest };

  if (parameters !== undefined) {
    const parameterShapes: Partial<
      Record<ParameterDefinition["location"], Record<string, z.ZodType>>
    > = {};

    for (const [name, definition] of Object.entries(parameters)) {
      const shape = (parameterShapes[definition.location] ??= {});
      shape[name] = parameterSchema(definition);
    }

    if (parameterShapes.params !== undefined) {
      request.params = z.object(parameterShapes.params);
    }
    if (parameterShapes.query !== undefined) {
      request.query = z.object(parameterShapes.query);
    }
  }

  const responses =
    legacyResponses === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(legacyResponses).map(([status, response]) => {
            const {
              contentType,
              schema: responseSchema,
              ...nativeResponse
            } = response;

            if (
              responseSchema !== undefined &&
              nativeResponse.content === undefined
            ) {
              nativeResponse.content = {
                [contentType ?? "application/json"]: {
                  schema: responseSchema,
                },
              };
            }

            return [status, nativeResponse];
          }),
        );

  return {
    ...rest,
    ...(Object.keys(request).length === 0 ? {} : { request }),
    ...(responses === undefined ? {} : { responses }),
  };
}
