import MAINNET_TOKENS from "./mainnet.json";
import GOERLI_TOKENS from "./goerli.json";
import { constants } from "starknet";

export const TOKENS_BY_CHAIN_ID = {
  [constants.StarknetChainId.SN_MAIN]: MAINNET_TOKENS,
  [constants.StarknetChainId.SN_GOERLI]: GOERLI_TOKENS,
} as const;

export function feeTokenAddress(chainId: constants.StarknetChainId): bigint {
  return chainId === constants.StarknetChainId.SN_MAIN
    ? 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n
    : 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n;
}

export function feeToken(chainId: constants.StarknetChainId) {
  return getTokenByAddress(chainId, feeTokenAddress(chainId));
}

export function getTokenByAddress(
  chainId: constants.StarknetChainId,
  address: string | bigint
) {
  return (TOKENS_BY_CHAIN_ID[chainId] ?? [])?.find(
    (x) => BigInt(x.l2_token_address) === BigInt(address)
  );
}

export function parseTokenIdentifier(
  chainId: constants.StarknetChainId,
  identifier: string
): bigint {
  if (/^0x[a-fA-F0-9]+$/.test(identifier) || /^\d+$/.test(identifier)) {
    return BigInt(identifier);
  }

  const found = (TOKENS_BY_CHAIN_ID[chainId] ?? [])?.find(
    (x) => x.symbol.toLowerCase() === identifier.toLowerCase()
  )?.l2_token_address;
  if (!found) {
    throw new Error(`Unrecognized token identifier: "${identifier}"`);
  }
  return BigInt(found);
}
