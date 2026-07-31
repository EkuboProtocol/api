import { Env } from "../env";
import {
  OpenAPIRoute,
  type OpenAPIRouteSchema as ChanfanaOpenAPIRouteSchema,
} from "chanfana";
import { IRequest } from "itty-router";
import { OpenAPIRouteSchema, toChanfanaSchema } from "./openapi";

export interface RequestContext {
  readonly env: Env;
}

export abstract class EkuboAPIRoute extends OpenAPIRoute<
  [request: IRequest, context: RequestContext]
> {
  public static readonly route: string;
  public static readonly schema: OpenAPIRouteSchema = {};

  public getSchema(): ChanfanaOpenAPIRouteSchema {
    const constructor = this.constructor as typeof EkuboAPIRoute;
    return toChanfanaSchema(constructor.schema);
  }

  public async handle(
    request: IRequest,
    context: RequestContext,
  ): Promise<Response | object> {
    await this.getValidatedData();
    return this.handleRequest(request, context);
  }

  abstract handleRequest(
    request: IRequest,
    context: RequestContext,
  ): Response | object | Promise<Response | object>;
}
