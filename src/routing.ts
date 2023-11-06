interface PoolKey {
  token0: bigint;
  token1: bigint;
  fee: bigint;
  tick_spacing: number;
  extension: bigint;
}

enum SwapStepType {
  swap = "swap",
  split = "split",
  clear = "clear",
}

interface SwapStep {
  type: SwapStepType;
  id: number;
}

type SplitTarget =
  | {
      to_step: number;
      percent_x128: bigint;
    }
  | {
      to_step: number;
      amount: bigint;
    };

interface SwapNode extends SwapStep {
  type: SwapStepType.swap;
  pool_key: PoolKey;
  sqrt_ratio_limit: bigint;
  is_token1: boolean;
  next_id: number;
}
interface SplitNode extends SwapStep {
  type: SwapStepType.split;
  targets: SplitTarget[];
}

interface ClearNode extends SwapStep {
  type: SwapStepType.clear;
}

export type QuoteNode = SwapNode | ClearNode | SplitNode;

interface QuoteReply {
  calculated_amount: bigint;
  route: QuoteNode;
}

interface TokenAmount {
  token: bigint;
  amount: bigint;
}

interface Pool {
  pool_key: PoolKey;
  sqrt_ratio: bigint;
  liquidity: bigint;
  tick: number;
  ticks: {
    index: number;
    liquidity_delta: bigint;
  }[];
}

type QuoteParameters =
  | {
      buy_amount: TokenAmount;
      sell_token: bigint;
    }
  | {
      sell_amount: TokenAmount;
      buy_token: bigint;
    };

export interface Router {
  quote(allPools: Pool[], params: QuoteParameters): QuoteReply;
}
