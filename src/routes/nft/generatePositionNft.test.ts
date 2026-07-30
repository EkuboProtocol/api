import { describe, expect, it } from "bun:test";
import type { PositionMetadata, Queries } from "../../queries";
import { generatePositionNft } from "./generatePositionNft";

const POSITION_METADATA: PositionMetadata = {
  minted_tx_hash: "1",
  minted_timestamp: new Date(0),
  positions_address: "2",
  salt: "3",
  lower_bound: "-1024",
  upper_bound: "1024",
  token0: "4",
  token1: "5",
  fee: "0",
  fee_denominator: "1000000000000000000",
  tick_spacing: "1024",
  extension: "6",
  stableswap_center_tick: null,
  stableswap_amplification: null,
};

describe("generatePositionNft", () => {
  it("renders ve33 positions with the dynamic fee and ve33 marks", async () => {
    const queries = {
      getErc20TokenByAddress: async () => null,
      getPoolClassification: async () => ({
        is_twamm: true,
        is_oracle: false,
        is_mev_capture: false,
        is_boosted_fees: false,
        is_ve33: true,
      }),
    } as unknown as Queries;

    const svg = await generatePositionNft(
      7n,
      "4663",
      queries,
      POSITION_METADATA,
    );

    expect(svg).toContain('<tspan font-style="italic">Dyn.</tspan>');
    expect(svg).toMatch(/>\s*ve33\s*<\/text>/);
    expect(svg).not.toMatch(/>\s*0%\s*</);
  });
});
