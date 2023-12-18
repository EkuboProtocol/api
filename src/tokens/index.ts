import MAINNET_TOKENS from "./mainnet.json";
import GOERLI_TOKENS from "./goerli.json";
import { constants, num, shortString } from "starknet";
import { Queries } from "../queries";
import { Env } from "../env";

export type TokenInfo = typeof MAINNET_TOKENS[number];

const DEFAULT_TOKENS_BY_CHAIN_ID: {
  [key in constants.StarknetChainId]: TokenInfo[];
} = {
  [constants.StarknetChainId.SN_MAIN]: MAINNET_TOKENS,
  [constants.StarknetChainId.SN_GOERLI]: GOERLI_TOKENS,
} as const;

export const FEE_TOKEN_ADDRESS = {
  [constants.StarknetChainId.SN_MAIN]:
    0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n,
  [constants.StarknetChainId.SN_GOERLI]:
    0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n,
};

let lastGetAllTokens: {
  [chainId in constants.StarknetChainId]?: {
    timestamp: number;
    result: TokenInfo[];
  };
} = {};
const MEMORY_CACHE_TIME = 300_000;

export async function getAllTokens(
  env: Env,
  queries: Queries
): Promise<TokenInfo[]> {
  const last = lastGetAllTokens[env.STARKNET_CHAIN_ID];
  if (last && last.timestamp >= Date.now() - MEMORY_CACHE_TIME) {
    return last.result;
  }

  const tokens = DEFAULT_TOKENS_BY_CHAIN_ID[env.STARKNET_CHAIN_ID] ?? [];

  const { rows } = await queries.getRegisteredTokens();

  rows.forEach((row) => {
    try {
      const name = shortString.decodeShortString(row.name).trim();
      const symbol = shortString.decodeShortString(row.symbol).trim();
      const l2_token_address = num.toHex(row.address);
      if (symbol.length > 6) return;
      if (!/^[\x00-\x7F]*$/.test(name) || !/^[\x00-\x7F]*$/.test(symbol))
        return;

      if (
        // if we find any token matching name symbol etc we skip it
        !tokens.find(
          (t) =>
            BigInt(t.l2_token_address) === BigInt(l2_token_address) ||
            t.symbol.toLowerCase() === symbol.toLowerCase() ||
            t.name === name.toLowerCase()
        )
      ) {
        tokens.push({
          name,
          symbol,
          decimals: row.decimals,
          l2_token_address,
          sort_order: 1,
          hidden: true,
        });
      }
    } catch (error) {}
  });

  lastGetAllTokens[env.STARKNET_CHAIN_ID] = {
    timestamp: Date.now(),
    result: tokens,
  };

  return tokens;
}

export function getTokenByAddress(
  tokens: TokenInfo[],
  address: string | bigint
): TokenInfo | undefined {
  return tokens?.find((x) => BigInt(x.l2_token_address) === BigInt(address));
}

export function getTokenByIdentifier(
  tokens: TokenInfo[],
  identifier: string
): TokenInfo | undefined {
  if (/^0x[a-fA-F0-9]+$/.test(identifier) || /^\d+$/.test(identifier)) {
    return getTokenByAddress(tokens, identifier);
  }

  return tokens.find(
    (x) => x.symbol.toLowerCase() === identifier.toLowerCase()
  );
}
