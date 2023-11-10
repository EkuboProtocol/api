import { toSqrtRatio } from "./tick";
import { PlainPool } from "../nodes/plainPool";

describe(toSqrtRatio, () => {
  it("min tick", () => {
    expect(toSqrtRatio(PlainPool.MIN_TICK)).toEqual(PlainPool.MIN_SQRT_RATIO);
  });
  it("max tick", () => {
    expect(toSqrtRatio(PlainPool.MAX_TICK)).toEqual(PlainPool.MAX_SQRT_RATIO);
  });
  it("zero", () => {
    expect(toSqrtRatio(0)).toEqual(1n << 128n);
  });
});
