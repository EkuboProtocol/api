import { Env } from "../env";
import { IRequest, StatusError } from "itty-router";
import { createQueries, Queries } from "../queries";
import {
  getDefaultTokens,
  getTokenParsedAddressByIdentifier,
} from "../routes/meta/tokens";

export async function parseOutTokens(
  env: Env,
  params: IRequest["params"],
): Promise<{
  queries: Queries;
  pair: {
    token0: bigint;
    token1: bigint;
  };
}> {
  const queries = await createQueries(env);
  const allTokens = getDefaultTokens(env);

  const tokenA = getTokenParsedAddressByIdentifier(allTokens, params.tokenA);
  const tokenB = getTokenParsedAddressByIdentifier(allTokens, params.tokenB);

  if (tokenA === undefined) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenA}"`);
  }
  if (tokenB === undefined) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenB}"`);
  }
  if (tokenA === tokenB) {
    throw new StatusError(400, `tokenA cannot be equal to tokenB`);
  }

  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];

  return {
    queries,
    pair: {
      token0,
      token1,
    },
  };
}
