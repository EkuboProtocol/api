import { z } from "@hono/zod-openapi";

const HEX_STRING_REGEX = /^0x[a-fA-F0-9]+$/;
// Plain digits only: every accepted value must parse with BigInt, which
// rejects exponent forms such as 1e5.
const DECIMAL_STRING_REGEX = /^\d+$/;

// Chain IDs are stored as Postgres int8.
const MAX_CHAIN_ID = (1n << 63n) - 1n;

export const DecimalStringType = z
  .string()
  .describe("A decimal number")
  .regex(DECIMAL_STRING_REGEX);

export const HexStringType = z
  .string()
  .describe("A hexadecimal number")
  .regex(HEX_STRING_REGEX);

export const NumericStringType = HexStringType.or(DecimalStringType).openapi({
  title: "Numeric",
  description: "A number represented in hexadecimal or decimal",
});

export const AddressType = NumericStringType.openapi({
  title: "Address",
  description: "An address on the specified blockchain network",
});

export const TokenIdentifierType = AddressType;

// For routes that keep the chain ID as a string, so that a value outside int8
// is a 400 rather than a database error.
export const ChainIdStringType = NumericStringType.refine((value) => {
  const chainId = BigInt(value);
  return chainId >= 1n && chainId <= MAX_CHAIN_ID;
}, "Chain ID out of range");

export const ChainIdType = z.coerce
  .bigint()
  .min(1n)
  .max(MAX_CHAIN_ID)
  .openapi({
    title: "Chain ID",
    description: "The ID of the network that is being fetched",
    type: "integer",
    format: "int64",
    minimum: 1,
    maximum: Number(1n << 63n),
  });

export const VisibilityPriorityType = z.coerce
  .number()
  .int()
  .min(-100)
  .max(100)
  .openapi({
    title: "Visibility Priority",
    description: "Token visibility priority threshold",
  });
