// The messages a wallet signs: EIP-712 typed data on EVM chains, SNIP-12
// (revision 1) on Starknet. The server rebuilds the exact message from what
// it stored when verifying, so a signature over anything else fails.
import type { Namespace } from "./chains";
import { randomHex } from "./crypto";

export const DOMAIN_NAME = "ekubo.org";
export const DOMAIN_VERSION = "1";

export interface LinkMessage {
  readonly kind: "link";
  readonly xUserId: string;
  readonly xHandle: string;
}

export interface UnlinkMessage {
  readonly kind: "unlink";
}

export interface MessageParams {
  readonly namespace: Namespace;
  /** Decimal chain ID. */
  readonly chainId: string;
  /** Canonical address. */
  readonly address: string;
  readonly nonce: string;
  /** Unix seconds. */
  readonly issuedAt: number;
  /** Unix seconds. */
  readonly expiresAt: number;
  readonly content: LinkMessage | UnlinkMessage;
}

export interface TypedData {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, string | number>;
  message: Record<string, string | number>;
}

export function newNonce(namespace: Namespace): `0x${string}` {
  // bytes32 on EVM; on Starknet a felt, so 31 bytes keeps it below the prime.
  return randomHex(namespace === "evm" ? 32 : 31);
}

export function statement(content: LinkMessage | UnlinkMessage): string {
  return content.kind === "link"
    ? `Link this wallet to the X account @${content.xHandle} on ekubo.org. The link is public: anyone can see that this address belongs to @${content.xHandle}.`
    : "Remove the link between this wallet and its X account on ekubo.org.";
}

function fields(
  params: MessageParams,
  types: {
    string: string;
    id: string;
    address: string;
    nonce: string;
    time: string;
  },
) {
  const link = params.content.kind === "link";
  return [
    { name: "statement", type: types.string },
    ...(link
      ? [
          { name: "xUserId", type: types.id },
          { name: "xHandle", type: types.id },
        ]
      : []),
    { name: "account", type: types.address },
    { name: "nonce", type: types.nonce },
    { name: "issuedAt", type: types.time },
    { name: "expiresAt", type: types.time },
  ];
}

function messageValues(params: MessageParams, nonce: string, account: string) {
  const content = params.content;
  return {
    statement: statement(content),
    ...(content.kind === "link"
      ? { xUserId: content.xUserId, xHandle: content.xHandle }
      : {}),
    account,
    nonce,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
  };
}

function primaryType(params: MessageParams) {
  return params.content.kind === "link" ? "LinkXAccount" : "UnlinkXAccount";
}

function evmTypedData(params: MessageParams): TypedData {
  const primary = primaryType(params);
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      [primary]: fields(params, {
        string: "string",
        id: "string",
        address: "address",
        nonce: "bytes32",
        time: "uint64",
      }),
    },
    primaryType: primary,
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(params.chainId),
    },
    message: messageValues(params, params.nonce, params.address),
  };
}

function starknetTypedData(params: MessageParams): TypedData {
  const primary = primaryType(params);
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      [primary]: fields(params, {
        string: "string",
        id: "shortstring",
        address: "ContractAddress",
        nonce: "felt",
        time: "timestamp",
      }),
    },
    primaryType: primary,
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: "SN_MAIN",
      revision: "1",
    },
    message: messageValues(params, params.nonce, params.address),
  };
}

export function typedDataFor(params: MessageParams): TypedData {
  return params.namespace === "evm"
    ? evmTypedData(params)
    : starknetTypedData(params);
}
