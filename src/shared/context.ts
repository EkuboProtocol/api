import { Env } from "../env";
import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { IRequest } from "itty-router";

export interface RequestContext {
  readonly env: Env;
}

export abstract class EkuboAPIRoute extends OpenAPIRoute<
  IRequest,
  [context: RequestContext]
> {
  public static readonly route: string;

  abstract handle(request: IRequest, context: RequestContext): any;
}
