import type { Env } from "../../env";
import { StatusError } from "../../shared/errors";

export type Namespace = "evm" | "starknet";

export const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;

// The networks a link can be verified on, with the Alchemy network each
// contract-account signature (ERC-1271, ERC-6492, Starknet) is checked
// against. These checks trust the RPC: a wrong answer would link any address
// on that chain, so they go only to Ekubo's own Alchemy app (ALCHEMY_API_KEY),
// never to a public endpoint. A chain Alchemy does not serve is not listed.
const ALCHEMY_NETWORKS: Readonly<Record<string, string>> = {
  "1": "eth-mainnet",
  "10": "opt-mainnet",
  "56": "bnb-mainnet",
  "100": "gnosis-mainnet",
  "130": "unichain-mainnet",
  "137": "polygon-mainnet",
  "143": "monad-mainnet",
  "4663": "robinhood-mainnet",
  "8453": "base-mainnet",
  "42161": "arb-mainnet",
  "57073": "ink-mainnet",
  [STARKNET_MAINNET_CHAIN_ID.toString()]: "starknet-mainnet",
};

export const SUPPORTED_CHAIN_IDS: readonly string[] =
  Object.keys(ALCHEMY_NETWORKS);

export interface Chain {
  /** Decimal chain ID. */
  readonly id: string;
  readonly namespace: Namespace;
}

export function parseChain(value: string | bigint): Chain {
  let id: bigint;
  try {
    id = BigInt(value);
  } catch {
    throw new StatusError(400, "chain_id must be a decimal or 0x number");
  }
  const key = id.toString();
  if (!(key in ALCHEMY_NETWORKS)) {
    throw new StatusError(
      400,
      `chain_id ${key} is not supported; use one of ${SUPPORTED_CHAIN_IDS.join(", ")}`,
    );
  }
  return {
    id: key,
    namespace: id === STARKNET_MAINNET_CHAIN_ID ? "starknet" : "evm",
  };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STARKNET_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
const STARKNET_ADDRESS_LIMIT = 1n << 251n;

/** The stored form: EVM 0x + 40 lowercase hex, Starknet 0x + 64. */
export function canonicalAddress(namespace: Namespace, value: string): string {
  if (namespace === "evm") {
    if (!EVM_ADDRESS.test(value)) {
      throw new StatusError(400, "address must be a 0x-prefixed EVM address");
    }
    return value.toLowerCase();
  }
  if (!STARKNET_ADDRESS.test(value) || BigInt(value) === 0n) {
    throw new StatusError(
      400,
      "address must be a 0x-prefixed Starknet address",
    );
  }
  const address = BigInt(value);
  if (address >= STARKNET_ADDRESS_LIMIT) {
    throw new StatusError(400, "address is outside the Starknet address range");
  }
  return `0x${address.toString(16).padStart(64, "0")}`;
}

export function rpcUrl(env: Env, chainId: string): string {
  const network = ALCHEMY_NETWORKS[chainId];
  if (!network)
    throw new StatusError(400, `chain_id ${chainId} is not supported`);
  const key = encodeURIComponent(env.ALCHEMY_API_KEY);
  return chainId === STARKNET_MAINNET_CHAIN_ID.toString()
    ? `https://${network}.g.alchemy.com/starknet/version/rpc/v0_10/${key}`
    : `https://${network}.g.alchemy.com/v2/${key}`;
}
