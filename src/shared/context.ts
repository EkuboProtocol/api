import {
  OpenAPIHono,
  z,
  type RouteConfig,
  type RouteHandler,
} from "@hono/zod-openapi";
import type { Env } from "../env";
import { StatusError } from "./errors";

export interface AppEnv {
  Bindings: Env;
}

export type App = OpenAPIHono<AppEnv>;

export interface ApiRoute<R extends RouteConfig = RouteConfig> {
  readonly route: R;
  readonly handler: RouteHandler<R, AppEnv>;
}

// Pairs a route with its handler so the handler is typed against the route's
// declared parameters and responses.
export function defineRoute<R extends RouteConfig>(
  route: R,
  handler: RouteHandler<R, AppEnv>,
): ApiRoute<R> {
  return { route, handler };
}

function formatIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .map(({ path, message }) =>
      path.length === 0 ? message : `${path.map(String).join(".")}: ${message}`,
    )
    .join("; ");
}

export function createApp(): App {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            status: 400,
            error: `Invalid ${result.target}: ${formatIssues(result.error)}`,
          },
          400,
        );
      }
    },
  });

  app.notFound((c) => c.json({ status: 404, error: "Not Found" }, 404));

  app.onError((e, c) => {
    // Handlers that parse values beyond their declared parameters report
    // failures as a ZodError; those are still the caller's fault.
    if (e instanceof z.ZodError) {
      return c.json({ status: 400, error: formatIssues(e) }, 400);
    }
    if (e instanceof StatusError) {
      return c.json(
        { status: e.status, error: e.message },
        e.status as 400 | 404 | 500,
      );
    }
    console.error(e);
    return c.json({ status: 500, error: "Internal server error" }, 500);
  });

  return app;
}
