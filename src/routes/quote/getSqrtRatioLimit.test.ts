import { getSqrtRatioLimit } from "./getSqrtRatioLimit";
import { describe, expect, it } from "vitest";
import { MAX_SQRT_RATIO, MAX_TICK_SPACING, MIN_SQRT_RATIO } from "./math/tick";

describe(getSqrtRatioLimit, () => {
  it("increases/decreases amount based on direction", () => {
    expect(getSqrtRatioLimit(1n << 128n, 200, true)).toMatchInlineSnapshot(
      `349036238196997812930660241101487815190n`,
    );
    expect(getSqrtRatioLimit(1n << 128n, 200, false)).toMatchInlineSnapshot(
      `331748043800433570885727608789418076840n`,
    );
  });

  it("increases/decreases amount more for larger tick spacing", () => {
    expect(getSqrtRatioLimit(1n << 128n, 5982, true)).toMatchInlineSnapshot(
      `727409348224962330549907031049362528789n`,
    );
    expect(getSqrtRatioLimit(1n << 128n, 5982, false)).toMatchInlineSnapshot(
      `159184219339322736410901005023815417372n`,
    );
  });
  it("min sqrt ratio", () => {
    expect(
      getSqrtRatioLimit(MIN_SQRT_RATIO, MAX_TICK_SPACING, true),
    ).toMatchInlineSnapshot(`692022112070556512811692140356186315659n`);
    expect(
      getSqrtRatioLimit(MIN_SQRT_RATIO, MAX_TICK_SPACING, false),
    ).toMatchInlineSnapshot(`18446748437148339062n`);
  });
  it("max sqrt ratio", () => {
    expect(getSqrtRatioLimit(MAX_SQRT_RATIO, MAX_TICK_SPACING, true)).toEqual(
      MAX_SQRT_RATIO - 1n,
    );
    expect(
      getSqrtRatioLimit(MAX_SQRT_RATIO, MAX_TICK_SPACING, false),
    ).toMatchInlineSnapshot(`167324262068536877884077394263793884480n`);
    expect(
      getSqrtRatioLimit(MAX_SQRT_RATIO, MAX_TICK_SPACING * 2, false),
    ).toMatchInlineSnapshot(`18446748437148339061n`);
  });
});
