import { constants } from "starknet";

export const ALL_TIME = new Date(0);
export const POSITIONS_CONTRACT_ADDRESS: {
  [chainId in constants.StarknetChainId]: bigint;
} = {
  ["0x534e5f4d41494e"]:
    0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067n,
  ["0x534e5f474f45524c49"]:
    0x073fa8432bf59f8ed535f29acfd89a7020758bda7be509e00dfed8a9fde12ddcn,
};
