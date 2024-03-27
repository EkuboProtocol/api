import { getSqrtRatioLimit } from "./getSqrtRatioLimit";
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MAX_TICK_SPACING,
  MIN_SQRT_RATIO,
} from "./math/tick";

describe(getSqrtRatioLimit, () => {
  it("increases/decreases amount based on direction", () => {
    expect(getSqrtRatioLimit(1n << 128n, 200, true)).toMatchInlineSnapshot(`344631509405125182002617808518792873970n`);
    expect(getSqrtRatioLimit(1n << 128n, 200, false)).toMatchInlineSnapshot(`335988109262519439300245059278655920158n`);
  });

  it("increases/decreases amount more for larger tick spacing", () => {
    expect(getSqrtRatioLimit(1n << 128n, 5982, true)).toMatchInlineSnapshot(
      995036832955257650875497961108515997522n,
    );
    expect(getSqrtRatioLimit(1n << 128n, 5982, false)).toMatchInlineSnapshot(
      116369651255435332198942046234037800911n,
    );
  });
  it("min sqrt ratio", () => {
    expect(
      getSqrtRatioLimit(MIN_SQRT_RATIO, MAX_TICK_SPACING, true),
    ).toMatchInlineSnapshot(`112984768063264311401350412505n`);
    expect(
      getSqrtRatioLimit(MIN_SQRT_RATIO, MAX_TICK_SPACING, false),
    ).toMatchInlineSnapshot(`18446748437148339062n`);
  });
  it("max sqrt ratio", () => {
    expect(
      getSqrtRatioLimit(MAX_SQRT_RATIO, MAX_TICK_SPACING, true),
    ).toMatchInlineSnapshot(`6277100250585753475930931601400621808602321654880405518631n`);
    expect(
      getSqrtRatioLimit(MAX_SQRT_RATIO, MAX_TICK_SPACING, true),
    ).toMatchInlineSnapshot(`6277100250585753475930931601400621808602321654880405518631n`);
  });
});
