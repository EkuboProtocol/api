import { findAllRoutes } from "./findAllRoutes";
import { NodeKey, Quote, QuoteNode } from "../../nodes/quoteNode";

class FakeQuoteNode implements QuoteNode<null> {
  constructor({ token0, token1 }: { token0: string; token1: string }) {
    this.key = {
      token0: BigInt(token0),
      token1: BigInt(token1),
      fee: 0n,
      tickSpacing: 0,
      extension: 0n,
    };
  }

  key: NodeKey;

  quote(params: {
    specifiedAmount: bigint;
    isToken1: boolean;
    sqrtRatioLimit?: bigint | undefined;
  }): Quote<null> {
    throw new Error("Method not implemented.");
  }
}

function fqn(p: { token0: string; token1: string }) {
  return new FakeQuoteNode(p);
}

describe(findAllRoutes, () => {
  it("no routes found", () => {
    expect(findAllRoutes(1n, 4n, [], 2, [])).toEqual([]);
  });
  it("one direct route found", () => {
    const nodes = [
      fqn({
        token0: "4",
        token1: "2",
      }),
      fqn({
        token0: "1",
        token1: "4",
      }),
    ];
    expect(findAllRoutes(1n, 4n, nodes, 2, [])).toEqual([[nodes[1]]]);
  });
  it("one multihop route found", () => {
    const nodes = [
      fqn({
        token0: "4",
        token1: "2",
      }),
      fqn({
        token0: "1",
        token1: "2",
      }),
    ];
    expect(findAllRoutes(1n, 4n, nodes, 2, [])).toEqual([[nodes[1], nodes[0]]]);
  });
  it("multiple routes", () => {
    const nodes = [
      fqn({
        token0: "4",
        token1: "2",
      }),
      fqn({
        token0: "1",
        token1: "2",
      }),
      fqn({
        token0: "4",
        token1: "1",
      }),
    ];
    expect(findAllRoutes(1n, 4n, nodes, 2, [])).toEqual([
      [nodes[1], nodes[0]],
      [nodes[2]],
    ]);
  });
  it("uninvolved tokens", () => {
    const nodes = [
      fqn({
        token0: "4",
        token1: "2",
      }),
      fqn({
        token0: "1",
        token1: "2",
      }),
      fqn({
        token0: "4",
        token1: "1",
      }),
      fqn({
        token0: "3",
        token1: "1",
      }),
      fqn({
        token0: "2",
        token1: "3",
      }),
    ];
    expect(findAllRoutes(1n, 4n, nodes, 2, [])).toEqual([
      [nodes[1], nodes[0]],
      [nodes[2]],
    ]);
  });
});
