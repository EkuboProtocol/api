import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from "./tick";

describe(toSqrtRatio, () => {
  it("min tick", () => {
    expect(toSqrtRatio(MIN_TICK)).toEqual(MIN_SQRT_RATIO);
  });
  it("max tick", () => {
    expect(toSqrtRatio(MAX_TICK)).toEqual(MAX_SQRT_RATIO);
  });
  it("zero", () => {
    expect(toSqrtRatio(0)).toEqual(1n << 128n);
  });

  it("snapshots", () => {
    expect(toSqrtRatio(1e6)).toMatchInlineSnapshot(
      `561030636129153856592777659729523183729n`
    );
    expect(toSqrtRatio(1e7)).toMatchInlineSnapshot(`50502254805927926084427918474025309948677n`);
    expect(toSqrtRatio(-1e6)).toMatchInlineSnapshot(
      `206391740095027370700312310531588921767n`
    );
    expect(toSqrtRatio(-1e7)).toMatchInlineSnapshot(`2292810285051363400276741638672651165n`);
  });
});
