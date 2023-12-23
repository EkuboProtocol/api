import { constants } from "starknet";

export const POSITIONS_CONTRACT_ADDRESS: {
  [chainId in constants.StarknetChainId]: bigint;
} = {
  [constants.StarknetChainId.SN_MAIN]:
    0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067n,
  [constants.StarknetChainId.SN_GOERLI]:
    0x073fa8432bf59f8ed535f29acfd89a7020758bda7be509e00dfed8a9fde12ddcn,
};
