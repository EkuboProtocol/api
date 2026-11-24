import { z } from "@hono/zod-openapi";
import { ErrorResponseType } from "../../shared/errors";
import { NumericStringType } from "../../shared/validation/address";
import { CODE_LENGTH } from "./crypto";

export const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LinkIdType = z
  .string()
  .regex(LINK_ID_PATTERN)
  .describe("Link ID returned by the start call. Keep it private");

export const ChainIdInputType = z
  .union([NumericStringType, z.number().int().positive()])
  .describe(
    "Chain ID, decimal or 0x hex. Starknet mainnet is 0x534e5f4d41494e",
  );

export const AddressInputType = z
  .string()
  .max(66)
  .describe("Wallet address, 0x hex")
  .openapi({ example: "0x7a16fF8270133F063aAb6C9977183D9e72835428" });

export const CodeType = z
  .string()
  .min(CODE_LENGTH)
  .max(CODE_LENGTH + 8)
  .describe(
    "Completion code shown to the person after approving on X (on the callback page, or as x_link_code on the return URL). Case and dashes are ignored",
  );

export const SignatureType = z
  .union([z.string().max(16_384), z.array(z.string().max(80)).max(32)])
  .describe(
    "EVM: the 0x hex signature over typed_data (ECDSA, ERC-1271 or ERC-6492). Starknet: the array of signature felts",
  );

const TypedDataType = z
  .object({
    types: z.record(
      z.string(),
      z.array(z.object({ name: z.string(), type: z.string() })),
    ),
    primaryType: z.string(),
    domain: z.record(z.string(), z.union([z.string(), z.number()])),
    message: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .describe(
    "The exact message to sign: EIP-712 typed data on EVM chains (eth_signTypedData_v4), SNIP-12 revision 1 typed data on Starknet. Sign it unchanged",
  );

export const IdentityType = z.object({
  x_user_id: z.string().describe("Immutable numeric X user ID"),
  x_handle: z
    .string()
    .describe(
      "X handle without the @, as it was when linked. A renamed account shows its old handle until relinked",
    ),
  x_url: z.string().describe("Profile URL on x.com, by user ID"),
  linked_at: z.string().describe("When the link was made, ISO 8601"),
  scope: z
    .enum(["namespace", "chain"])
    .describe(
      "namespace: proven by the address's own key, holds on every EVM chain. chain: proven by a contract account, holds only on verified_chain_id",
    ),
  verified_chain_id: z
    .string()
    .describe("Decimal ID of the chain the signature was checked on"),
  signature_kind: z.enum(["ecdsa", "erc1271", "erc6492", "starknet"]),
});

export const LinkStartRequestType = z.object({
  chain_id: ChainIdInputType,
  address: AddressInputType,
  return_to: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe(
      "Page on an allowed Ekubo origin to send the browser back to after X, with x_link=complete|cancelled|failed and x_link_code. Omit it (agents) to show the code on a page instead",
    ),
});

export const LinkStartResponseType = z.object({
  link_id: LinkIdType,
  authorization_url: z
    .string()
    .describe("Open this in the person's browser to approve on x.com"),
  expires_at: z.string().describe("ISO 8601; X approval must finish by then"),
});

export const LinkStatusType = z.object({
  link_id: LinkIdType,
  status: z
    .enum(["awaiting_x", "awaiting_signature"])
    .describe(
      "awaiting_x: the person has not approved on X yet. awaiting_signature: X is verified; with the code, typed_data is returned to sign",
    ),
  chain_id: z.string().describe("Decimal chain ID"),
  address: z.string().describe("Canonical address being linked"),
  expires_at: z.string().describe("ISO 8601"),
  x_user_id: z.string().nullable(),
  x_handle: z.string().nullable(),
  typed_data: TypedDataType.nullable().describe(
    "Null until X is verified and the right code is given",
  ),
});

export const LinkCompleteRequestType = z.object({
  code: CodeType,
  signature: SignatureType,
});

export const LinkCompleteResponseType = z.object({
  chain_id: z.string(),
  address: z.string(),
  identity: IdentityType,
});

export const UnlinkMessageRequestType = z.object({
  chain_id: ChainIdInputType,
  address: AddressInputType,
});

export const UnlinkMessageResponseType = z.object({
  nonce: z.string(),
  expires_at: z.string().describe("ISO 8601"),
  typed_data: TypedDataType,
});

export const UnlinkRequestType = z.object({
  chain_id: ChainIdInputType,
  address: AddressInputType,
  nonce: z.string().regex(/^0x[0-9a-f]{62,64}$/),
  signature: SignatureType,
});

export const UnlinkResponseType = z.object({
  removed: z
    .number()
    .int()
    .describe(
      "Links removed. An ECDSA signature removes every link of the address; a contract-account signature only the link on its chain",
    ),
});

export const LookupResponseType = z.object({
  chain_id: z.string(),
  identities: z
    .record(z.string(), IdentityType.nullable())
    .describe(
      "Keyed by canonical address (EVM lowercase; Starknet 0x + 64 hex). Null when the address has no link on this chain",
    ),
});

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ErrorResponseType } },
  };
}

export const identityErrors = {
  429: errorResponse("Too many requests from this IP or for this address"),
  503: errorResponse(
    "Linking is not available here, or the chain could not be reached; retry",
  ),
} as const;

export const linkErrors = {
  ...identityErrors,
  401: errorResponse("The signature does not prove the address signed"),
  403: errorResponse("The completion code is wrong"),
  404: errorResponse("Unknown or expired link; start again"),
  409: errorResponse("Not ready for this step, or the nonce was already used"),
} as const;
