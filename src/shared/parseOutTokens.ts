import { Env } from "../env";
import { IRequest, StatusError } from "itty-router";
import { createQueries, Queries } from "../queries";
import {
  getAllTokens,
  getTokenByIdentifier,
  TokenInfo,
} from "../routes/meta/tokens";

export async function parseOutTokens(
  env: Env,
  params: IRequest["params"],
): Promise<{
  queries: Queries;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  pair: {
    token0: bigint;
    token1: bigint;
  };
}> {
  const queries = await createQueries(env);
  const allTokens = await getAllTokens(env);

  const tokenA = getTokenByIdentifier(allTokens, params.tokenA);
  const tokenB = getTokenByIdentifier(allTokens, params.tokenB);

  if (!tokenA) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenA}"`);
  }
  if (!tokenB) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenB}"`);
  }
  if (tokenA.token_address === tokenB.token_address) {
    throw new StatusError(400, `tokenA cannot be equal to tokenB`);
  }

  const [token0, token1] =
    BigInt(tokenA.token_address) < BigInt(tokenB.token_address)
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  return {
    queries,
    tokenA,
    tokenB,
    pair: {
      token0: BigInt(token0.token_address),
      token1: BigInt(token1.token_address),
    },
  };
}
