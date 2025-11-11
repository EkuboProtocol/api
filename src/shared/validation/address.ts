import { z } from "zod";

const HEX_STRING_REGEX = /^0x[a-fA-F0-9]+$/;
const DECIMAL_STRING_REGEX = /^\d+e?\d*$/;

export const DecimalStringType = z
  .string({ description: "A decimal number" })
  .regex(DECIMAL_STRING_REGEX);

export const HexStringType = z
  .string({
    description: "A hexadecimal number",
  })
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

export const ChainIdType = z.coerce
  .bigint()
  .min(1n)
  .max(1n << 63n)
  .openapi({
    title: "Chain ID",
    description: "The ID of the network that is being fetched",
  });
