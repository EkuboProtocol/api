import { Env } from "../env";
import { IRequest, StatusError } from "itty-router";
import { createQueries, Queries } from "../queries";
import { getTokenByUserSpecifiedIdentifier } from "../routes/meta/tokens";

const RAW_TOKEN_ADDRESS_REGEX = /^(?:0x[a-fA-F0-9]+|\d+)$/;

// Resolves a user-supplied token identifier to its address. Registered
// tokens resolve through the token table; anything else must already be a
// raw address, so stats pages keep working for tokens the indexer has never
// registered. All downstream queries filter on raw addresses, so an
// unregistered token simply contributes no USD-denominated value.
export async function parseOutTokenAddress(
  queries: Queries,
  chainId: bigint,
  identifier: string,
): Promise<bigint> {
  const registered = await getTokenByUserSpecifiedIdentifier(
    queries,
    chainId,
    identifier,
  );
  if (registered) {
    return BigInt(registered.address);
  }

  const trimmed = identifier.trim();
  if (RAW_TOKEN_ADDRESS_REGEX.test(trimmed)) {
    return BigInt(trimmed);
  }

  throw new StatusError(400, `Invalid token identifier: "${identifier}"`);
}

export async function parseOutTokens(
  env: Env,
  params: IRequest["params"],
  chainId: bigint,
): Promise<{
  queries: Queries;
  pair: {
    chainId: bigint;
    token0: bigint;
    token1: bigint;
  };
}> {
  const queries = await createQueries(env);

  const [tokenAAddress, tokenBAddress] = await Promise.all([
    parseOutTokenAddress(queries, chainId, params.tokenA),
    parseOutTokenAddress(queries, chainId, params.tokenB),
  ]);

  if (tokenAAddress === tokenBAddress) {
    throw new StatusError(400, `tokenA cannot be equal to tokenB`);
  }

  const [token0, token1] =
    tokenAAddress < tokenBAddress
      ? [tokenAAddress, tokenBAddress]
      : [tokenBAddress, tokenAAddress];

  return {
    queries,
    pair: {
      chainId,
      token0,
      token1,
    },
  };
}
