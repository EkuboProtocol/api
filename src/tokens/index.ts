import MAINNET_TOKENS from "./mainnet.json";
import GOERLI_TOKENS from "./goerli.json";

export const TOKENS_BY_CHAIN_ID = {
  ["0x534e5f4d41494e"]: MAINNET_TOKENS,
  ["0x534e5f474f45524c49"]: GOERLI_TOKENS,
} as const;

export function feeToken(chainId: "0x534e5f474f45524c49" | "0x534e5f4d41494e") {
  return getTokenByAddress(
    chainId,
    chainId === "0x534e5f4d41494e"
      ? "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
      : chainId === "0x534e5f474f45524c49"
      ? "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
      : "0"
  );
}

export function getTokenByAddress(
  chainId: "0x534e5f474f45524c49" | "0x534e5f4d41494e",
  address: string | bigint
) {
  return (TOKENS_BY_CHAIN_ID[chainId] ?? [])?.find(
    (x) => BigInt(x.l2_token_address) === BigInt(address)
  );
}

export function parseTokenIdentifier(
  chainId: "0x534e5f474f45524c49" | "0x534e5f4d41494e",
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
