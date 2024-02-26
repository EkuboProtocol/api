import { findAllRoutes, HasKey } from "./findAllRoutes";

function fqn({ token0, token1 }: { token0: string; token1: string }): HasKey {
  return {
    key: {
      token0: BigInt(token0),
      token1: BigInt(token1),
      fee: 0n,
      tickSpacing: 0,
      extension: 0n,
    },
  };
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
