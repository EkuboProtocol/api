import { Env } from "../env";
import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { IRequest } from "itty-router";

export interface RequestContext {
  readonly env: Env;
}

export abstract class EkuboAPIRoute<T = any> extends OpenAPIRoute<
  IRequest,
  [context: RequestContext, data: T]
> {
  public static readonly route: string;

  abstract handle(request: IRequest, context: RequestContext, data: T): any;
}
