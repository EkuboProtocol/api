import { z } from "zod";

export const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

export const AddressType = z
  .string({ description: "A contract address on Starknet", coerce: true })
  .regex(ADDRESS_REGEX, { message: "Must be a hex formatted string" })
  .min(32);
