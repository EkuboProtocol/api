// Signature checks, in order: ECDSA by the address's own key, then ERC-1271
// on the account contract, then ERC-6492 for an account that is not deployed
// yet. Starknet accounts are always contracts, checked with
// is_valid_signature. Only an ECDSA signature proves control of the address
// on every chain; anything else is proven only on the chain it was checked on.
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  erc6492SignatureValidatorAbi,
  erc6492SignatureValidatorByteCode,
  hashTypedData,
  hexToBool,
  http,
  isErc6492Signature,
  isHex,
  recoverAddress,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { hash as starknetHash, typedData as snip12 } from "starknet";
import type { Env } from "../../env";
import { StatusError } from "../../shared/errors";
import { rpcUrl } from "./chains";
import type { MessageParams } from "./messages";
import { typedDataFor } from "./messages";

export type SignatureKind = "ecdsa" | "erc1271" | "erc6492" | "starknet";

export type Signature = string | readonly string[];

const RPC_TIMEOUT_MS = 10_000;
const STARKNET_VALID = "0x56414c4944"; // "VALID", returned by SNIP-6 accounts.

function rpcUnavailable(): StatusError {
  return new StatusError(
    503,
    "Could not reach the network to check the signature; retry",
  );
}

async function ecdsaSigner(hash: Hex, signature: Hex): Promise<string | null> {
  // 65-byte or 64-byte (EIP-2098) signatures only.
  if (signature.length !== 132 && signature.length !== 130) return null;
  try {
    return (await recoverAddress({ hash, signature })).toLowerCase();
  } catch {
    return null;
  }
}

// Transport failures (unreachable, timeout, HTTP error) are retryable; a
// revert or any other answer from the node means the signature is invalid.
function isNetworkError(error: unknown): boolean {
  const walk = (error as { walk?: (fn: (e: unknown) => boolean) => unknown })
    .walk;
  if (typeof walk !== "function") return false;
  return Boolean(
    walk.call(error, (e: unknown) => {
      const name = (e as { name?: string }).name;
      return name === "HttpRequestError" || name === "TimeoutError";
    }),
  );
}

const IS_VALID_SIGNATURE_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;
// The whole 32-byte return word: bytes4 magic, then 28 zero bytes. A prefix
// check would accept contracts that return caller-influenced data, such as
// the SHA-256 precompile.
const ERC1271_MAGIC_WORD = `0x1626ba7e${"0".repeat(56)}`;

type Client = ReturnType<typeof createPublicClient>;

/** The call's return data, or null if it reverted. */
async function ethCall(
  client: Client,
  args: { to?: Hex; data: Hex },
): Promise<Hex | null> {
  try {
    return (await client.call(args)).data ?? "0x";
  } catch (error) {
    if (isNetworkError(error)) throw rpcUnavailable();
    return null;
  }
}

async function verifyErc1271(
  client: Client,
  address: Hex,
  hash: Hex,
  signature: Hex,
) {
  const data = await ethCall(client, {
    to: address,
    data: encodeFunctionData({
      abi: IS_VALID_SIGNATURE_ABI,
      functionName: "isValidSignature",
      args: [hash, signature],
    }),
  });
  return data?.toLowerCase() === ERC1271_MAGIC_WORD;
}

// ERC-6492: the universal validator, run deployless, deploys the account
// through its factory inside the call and then checks ERC-1271.
async function verifyErc6492(
  client: Client,
  address: Hex,
  hash: Hex,
  signature: Hex,
) {
  const data = await ethCall(client, {
    data: encodeDeployData({
      abi: erc6492SignatureValidatorAbi,
      args: [address, hash, signature],
      bytecode: erc6492SignatureValidatorByteCode,
    }),
  });
  if (data === null || data === "0x") return false;
  try {
    return hexToBool(data);
  } catch {
    return false;
  }
}

async function verifyEvm(
  env: Env,
  params: MessageParams,
  signature: Hex,
): Promise<SignatureKind | null> {
  const hash = hashTypedData(
    typedDataFor(params) as unknown as TypedDataDefinition,
  );
  if ((await ecdsaSigner(hash, signature)) === params.address) return "ecdsa";

  const client = createPublicClient({
    transport: http(rpcUrl(env, params.chainId), {
      timeout: RPC_TIMEOUT_MS,
      retryCount: 1,
    }),
  });
  const address = params.address as Hex;
  if (isErc6492Signature(signature)) {
    return (await verifyErc6492(client, address, hash, signature))
      ? "erc6492"
      : null;
  }
  return (await verifyErc1271(client, address, hash, signature))
    ? "erc1271"
    : null;
}

const FELT_LIMIT = 1n << 252n;

function felt(value: string): string | null {
  if (!/^(0x[0-9a-fA-F]{1,64}|\d{1,77})$/.test(value)) return null;
  const n = BigInt(value);
  return n < FELT_LIMIT ? `0x${n.toString(16)}` : null;
}

async function starknetCall(
  url: string,
  address: string,
  entryPoint: string,
  calldata: string[],
): Promise<{ result?: string[]; error?: { code?: number } }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: {
          request: {
            contract_address: address,
            entry_point_selector: starknetHash.getSelectorFromName(entryPoint),
            calldata,
          },
          block_id: "latest",
        },
      }),
    });
  } catch {
    throw rpcUnavailable();
  }
  if (!response.ok) throw rpcUnavailable();
  const body = (await response.json().catch(() => null)) as {
    result?: string[];
    error?: { code?: number };
  } | null;
  if (!body || (body.result === undefined && body.error === undefined)) {
    throw rpcUnavailable();
  }
  return body;
}

function validResult(result: readonly string[] | undefined): boolean {
  const first = result?.[0];
  if (first === undefined) return false;
  const value = BigInt(first);
  return value === BigInt(STARKNET_VALID) || value === 1n;
}

async function verifyStarknet(
  env: Env,
  params: MessageParams,
  signature: readonly string[],
): Promise<SignatureKind | null> {
  const felts = signature.map(felt);
  if (felts.length === 0 || felts.some((f) => f === null)) return null;
  const messageHash = snip12.getMessageHash(
    typedDataFor(params),
    params.address,
  );
  const calldata = [
    messageHash,
    `0x${felts.length.toString(16)}`,
    ...(felts as string[]),
  ];
  const url = rpcUrl(env, params.chainId);
  // SNIP-6 accounts expose is_valid_signature; older Argent and Braavos
  // accounts the camel-case name.
  for (const entryPoint of ["is_valid_signature", "isValidSignature"]) {
    const { result } = await starknetCall(
      url,
      params.address,
      entryPoint,
      calldata,
    );
    if (result !== undefined) return validResult(result) ? "starknet" : null;
  }
  return null;
}

/**
 * Returns how the signature was proven, or null if it does not prove that
 * params.address signed exactly this message. Throws a 503 StatusError when
 * the chain could not be reached, so a caller can retry.
 */
export async function verifySignature(
  env: Env,
  params: MessageParams,
  signature: Signature,
): Promise<SignatureKind | null> {
  if (params.namespace === "evm") {
    if (typeof signature !== "string" || !isHex(signature)) {
      throw new StatusError(400, "signature must be a 0x hex string on EVM");
    }
    return verifyEvm(env, params, signature);
  }
  if (typeof signature === "string" || signature.length > 32) {
    throw new StatusError(
      400,
      "signature must be an array of at most 32 felts on Starknet",
    );
  }
  return verifyStarknet(env, params, signature);
}
