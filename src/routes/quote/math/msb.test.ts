import { describe, expect, it } from "vitest";
import msb from "./msb";

describe(msb, () => {
  it("zero or negative", () => {
    expect(() => msb(0n)).toThrow("x must be positive");
    expect(() => msb(-1n)).toThrow("x must be positive");
  });

  it("large", () => {
    expect(() => msb(1n << 128n)).toThrow("x too large");
  });

  it("small numbers", () => {
    expect(msb(1n)).toEqual(0);
    expect(msb(2n)).toEqual(1);
    expect(msb(3n)).toEqual(1);
    expect(msb(4n)).toEqual(2);
    expect(msb(5n)).toEqual(2);
    expect(msb(6n)).toEqual(2);
    expect(msb(7n)).toEqual(2);
    expect(msb(8n)).toEqual(3);
    expect(msb(9n)).toEqual(3);
  });

  it("large numbers", () => {
    expect(msb(2n ** 128n - 1n)).toEqual(127);
    expect(msb(2n ** 128n - 2n)).toEqual(127);
    expect(msb(2n ** 128n - 3n)).toEqual(127);
    expect(msb(2n ** 128n - 4n)).toEqual(127);
    expect(msb(2n ** 64n + 1n)).toEqual(64);
    expect(msb(2n ** 64n)).toEqual(64);
    expect(msb(2n ** 64n - 1n)).toEqual(63);
  });
});
