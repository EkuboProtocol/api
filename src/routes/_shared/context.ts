import { Env } from "../../env";
import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { IRequest } from "itty-router";
import { Client } from "pg";

export interface RequestContext {
  readonly env: Env;
  readonly client: Client;
}

export abstract class EkuboAPIRoute extends OpenAPIRoute<
  IRequest,
  [context: RequestContext]
> {
  static route: string;

  abstract handle(request: IRequest, context: RequestContext): any;
}
