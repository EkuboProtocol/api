import { Env } from "../../env";
import { OpenAPIRoute } from "@cloudflare/itty-router-openapi";
import { IRequest } from "itty-router";

export abstract class EkuboAPIRoute extends OpenAPIRoute<IRequest, [env: Env]> {
  static route: string;
  abstract handle(request: IRequest, env: Env): any;
}
