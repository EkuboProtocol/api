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

export const NumericType = HexStringType.or(DecimalStringType).openapi({
  title: "Numeric",
  description: "A number represented in hexadecimal or decimal",
});

export const AddressType = NumericType.openapi({
  title: "Address",
  description: "The address of a contract on Starknet",
});

export const TokenSymbolType = z
  .string()
  .min(1)
  .max(31)
  .regex(/^\w+$/)
  .openapi({
    title: "Symbol",
    description: "The symbol for a token",
  });

export const TokenIdentifierType = AddressType.or(TokenSymbolType);
