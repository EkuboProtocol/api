import { z } from "zod";

export const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

export const AddressType = z
  .string({ description: "A contract address on Starknet", coerce: true })
  .regex(ADDRESS_REGEX, { message: "Must be a hex formatted string" })
  .min(32)
  .openapi({
    title: "StarknetAddress",
    description: "The hex address of a contract on Starknet",
  });

export const TokenSymbolType = z
  .string()
  .min(1)
  .max(31)
  .regex(/^\w+$/)
  .openapi({
    title: "TokenSymbol",
    description: "The symbol for a token",
  });

export const TokenIdentifierType = AddressType.or(TokenSymbolType);
