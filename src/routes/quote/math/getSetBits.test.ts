import getSetBits from "./getSetBits";

describe(getSetBits, () => {
  it("", () => {
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
  });
});
