import { Env } from "../env";
import { IRequest, StatusError } from "itty-router";
import { createQueries, Queries } from "../queries";
import { getTokenByUserSpecifiedIdentifier } from "../routes/meta/tokens";

export async function parseOutTokens(
  env: Env,
  params: IRequest["params"],
  chainId: bigint,
): Promise<{
  queries: Queries;
  pair: {
    token0: bigint;
    token1: bigint;
  };
}> {
  const queries = await createQueries(env);

  const [tokenA, tokenB] = await Promise.all([
    getTokenByUserSpecifiedIdentifier(queries, chainId, params.tokenA),
    getTokenByUserSpecifiedIdentifier(queries, chainId, params.tokenB),
  ]);

  if (!tokenA) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenA}"`);
  }
  if (!tokenB) {
    throw new StatusError(400, `Invalid token identifier: "${params.tokenB}"`);
  }
  if (tokenA.token_address === tokenB.token_address) {
    throw new StatusError(400, `tokenA cannot be equal to tokenB`);
  }

  const tokenAAddress = BigInt(tokenA.token_address);
  const tokenBAddress = BigInt(tokenB.token_address);

  const [token0, token1] =
    tokenAAddress < tokenBAddress
      ? [tokenAAddress, tokenBAddress]
      : [tokenBAddress, tokenAAddress];

  return {
    queries,
    pair: {
      token0,
      token1,
    },
  };
}
