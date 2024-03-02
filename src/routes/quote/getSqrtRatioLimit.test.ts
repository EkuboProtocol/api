import { getSqrtRatioLimit } from "./getSqrtRatioLimit";

describe(getSqrtRatioLimit, () => {
  it("returns same for edge cases", () => {
    expect(getSqrtRatioLimit(1n << 128n, 1n << 128n, 0)).toEqual(1n << 128n);
    expect(getSqrtRatioLimit(1n << 128n, 1n << 128n, 1)).toEqual(1n << 128n);
    expect(getSqrtRatioLimit(1n << 128n, 1n << 128n, 5)).toEqual(1n << 128n);

    expect(getSqrtRatioLimit(1n << 128n, 1n << 127n, 0)).toEqual(1n << 127n);
    expect(getSqrtRatioLimit(1n << 128n, 1n << 129n, 0)).toEqual(1n << 129n);
  });

  it("increases/decreases amount based on direction", () => {
    expect(getSqrtRatioLimit(1n << 128n, 1n << 129n, 200)).toEqual(
      689263018810250364005235617037585747940n,
    );
    expect(getSqrtRatioLimit(1n << 128n, 1n << 127n, 200)).toEqual(
      167994054631259719650122529639327960079n,
    );
  });

  it("increases/decreases amount more for larger tick spacing", () => {
    expect(getSqrtRatioLimit(1n << 128n, 1n << 129n, 5982)).toEqual(
      995036832955257650875497961108515997522n,
    );
    expect(getSqrtRatioLimit(1n << 128n, 1n << 127n, 5982)).toEqual(
      116369651255435332198942046234037800911n,
    );
  });
});
