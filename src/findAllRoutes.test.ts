import { findAllRoutes } from "./findAllRoutes";

describe(findAllRoutes, () => {
  it("no routes found", () => {
    expect(findAllRoutes(1n, 4n, [], 2, [])).toEqual([]);
  });
  it("one direct route found", () => {
    expect(
      findAllRoutes(
        1n,
        4n,
        [
          {
            token0: "4",
            token1: "2",
          },
          {
            token0: "1",
            token1: "4",
          },
        ],
        2,
        []
      )
    ).toEqual([
      [
        {
          token0: "1",
          token1: "4",
        },
      ],
    ]);
  });
  it("one multihop route found", () => {
    expect(
      findAllRoutes(
        1n,
        4n,
        [
          {
            token0: "4",
            token1: "2",
          },
          {
            token0: "1",
            token1: "2",
          },
        ],
        2,
        []
      )
    ).toEqual([
      [
        {
          token0: "1",
          token1: "2",
        },
        {
          token0: "4",
          token1: "2",
        },
      ],
    ]);
  });
  it("multiple routes", () => {
    expect(
      findAllRoutes(
        1n,
        4n,
        [
          {
            token0: "4",
            token1: "2",
          },
          {
            token0: "1",
            token1: "2",
          },
          {
            token0: "4",
            token1: "1",
          },
        ],
        2,
        []
      )
    ).toEqual([
      [
        {
          token0: "1",
          token1: "2",
        },
        {
          token0: "4",
          token1: "2",
        },
      ],
      [
        {
          token0: "4",
          token1: "1",
        },
      ],
    ]);
  });
  it("uninvolved tokens", () => {
    expect(
      findAllRoutes(
        1n,
        4n,
        [
          {
            token0: "4",
            token1: "2",
          },
          {
            token0: "1",
            token1: "2",
          },
          {
            token0: "4",
            token1: "1",
          },
          {
            token0: "3",
            token1: "1",
          },
          {
            token0: "2",
            token1: "3",
          },
        ],
        2,
        []
      )
    ).toEqual([
      [
        {
          token0: "1",
          token1: "2",
        },
        {
          token0: "4",
          token1: "2",
        },
      ],
      [
        {
          token0: "4",
          token1: "1",
        },
      ],
    ]);
  });
});
