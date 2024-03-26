import { sqrtRate } from "./math";

describe(sqrtRate, () => {
  it("many such cases", () => {
    expect(sqrtRate(1n << 96n, 1n << 96n)).toBeCloseTo(1);
    expect(sqrtRate(1n << 96n, 2n << 96n)).toBeCloseTo(1.414213562373095);
    expect(sqrtRate(1n << 95n, 2n << 96n)).toBeCloseTo(1);
    expect(sqrtRate(10n << 96n, 5n << 96n)).toBeCloseTo(7.071067811865475);
  });
});