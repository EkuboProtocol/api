import getSetBits, { increaseLowestSetBit } from "./getSetBits";

describe(getSetBits, () => {
  it("examples", () => {
    expect(getSetBits(1n)).toEqual([0]);
    expect(getSetBits(2n)).toEqual([1]);
    expect(getSetBits(3n)).toEqual([1, 0]);
    expect(getSetBits(2n ** 128n - 1n)).toEqual(
      Array(128)
        .fill(null)
        .map((_, ix) => 127 - ix)
    );
    expect(getSetBits(2n ** 128n - 1n, 10)).toEqual(
      Array(10)
        .fill(null)
        .map((_, ix) => 127 - ix)
    );
    expect(getSetBits(2n ** 64n - 1n, 10)).toEqual(
      Array(10)
        .fill(null)
        .map((_, ix) => 63 - ix)
    );
    expect(getSetBits(2n ** 64n + 2n ** 31n + 2n ** 14n, 10)).toEqual([
      64, 31, 14,
    ]);
    expect(getSetBits(20_000_000_000n, 3)).toEqual([34, 31, 29]);
  });
});

describe(increaseLowestSetBit, () => {
  it("double bump", () => {
    const x = [3, 2, 1];
    increaseLowestSetBit(x);
    expect(x).toEqual([4]);
  });
  it("single bump", () => {
    const x = [4, 3, 1];
    increaseLowestSetBit(x);
    expect(x).toEqual([4, 3, 2]);
  });
  it("empty", () => {
    const x: number[] = [];
    increaseLowestSetBit(x);
    expect(x).toEqual([]);
  });
  it("single bit", () => {
    const x: number[] = [0];
    increaseLowestSetBit(x);
    expect(x).toEqual([1]);
  });
  it("2 bits combined", () => {
    const x: number[] = [1, 0];
    increaseLowestSetBit(x);
    expect(x).toEqual([2]);
  });
});
