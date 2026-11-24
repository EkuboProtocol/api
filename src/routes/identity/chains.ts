import type { Env } from "../../env";
import { StatusError } from "../../shared/errors";

export type Namespace = "evm" | "starknet";

export const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;

// The networks Ekubo is deployed on, with a public RPC used to verify
// contract-account signatures. RPC_URLS (a JSON object of decimal chain ID to
// URL, set as a secret) overrides any of them.
const PUBLIC_RPC_URLS: Readonly<Record<string, string>> = {
  "1": "https://ethereum-rpc.publicnode.com",
  "10": "https://optimism-rpc.publicnode.com",
  "56": "https://bsc-rpc.publicnode.com",
  "100": "https://gnosis-rpc.publicnode.com",
  "130": "https://mainnet.unichain.org",
  "137": "https://polygon-bor-rpc.publicnode.com",
  "143": "https://rpc.monad.xyz",
  "4663": "https://rpc.mainnet.chain.robinhood.com",
  "8453": "https://base-rpc.publicnode.com",
  "42161": "https://arbitrum-one-rpc.publicnode.com",
  "57073": "https://rpc-gel.inkonchain.com",
  "99901": "https://rpc.elysium.kinetiq.xyz",
  [STARKNET_MAINNET_CHAIN_ID.toString()]: "https://starknet-rpc.publicnode.com",
};

export const SUPPORTED_CHAIN_IDS: readonly string[] =
  Object.keys(PUBLIC_RPC_URLS);

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
  if (!(key in PUBLIC_RPC_URLS)) {
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
  if (env.RPC_URLS) {
    try {
      const overrides: unknown = JSON.parse(env.RPC_URLS);
      if (overrides && typeof overrides === "object" && chainId in overrides) {
        const url = (overrides as Record<string, unknown>)[chainId];
        if (typeof url === "string") return url;
      }
    } catch {
      // A malformed override falls back to the public RPC.
    }
  }
  const url = PUBLIC_RPC_URLS[chainId];
  if (!url) throw new StatusError(400, `chain_id ${chainId} is not supported`);
  return url;
}
