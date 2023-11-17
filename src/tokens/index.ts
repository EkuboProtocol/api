import MAINNET_TOKENS from "./mainnet.json";
import GOERLI_TOKENS from "./goerli.json";
import { SupportedChainId } from "../env";

export const TOKENS_BY_CHAIN_ID = {
  ["0x534e5f4d41494e"]: MAINNET_TOKENS,
  ["0x534e5f474f45524c49"]: GOERLI_TOKENS,
} as const;

export function feeTokenAddress(chainId: SupportedChainId): bigint {
  return chainId === "0x534e5f4d41494e"
    ? 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n
    : 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n;
}

export function feeToken(chainId: SupportedChainId) {
  return getTokenByAddress(chainId, feeTokenAddress(chainId));
}

export function getTokenByAddress(
  chainId: SupportedChainId,
  address: string | bigint
) {
  return (TOKENS_BY_CHAIN_ID[chainId] ?? [])?.find(
    (x) => BigInt(x.l2_token_address) === BigInt(address)
  );
}

export function parseTokenIdentifier(
  chainId: SupportedChainId,
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
