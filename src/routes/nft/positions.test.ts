import { describe, expect, test } from "bun:test";
import { getPositionEventIdRange } from "./positions";

const MIN_EVENT_ID = -(1n << 63n);
const MAX_EVENT_ID = (1n << 63n) - 1n;
const EVENT_ID_OFFSET = MIN_EVENT_ID + 1n;
const EVENTS_PER_BLOCK = 1n << 32n;

describe("getPositionEventIdRange", () => {
  test("uses the full signed event ID range by default", () => {
    expect(
      getPositionEventIdRange({
        cursor: null,
        fromBlock: null,
        toBlock: null,
      }),
    ).toEqual({
      minEventIdExclusive: MIN_EVENT_ID,
      maxEventIdInclusive: MAX_EVENT_ID,
    });
  });

  test("converts inclusive block bounds to event ID bounds", () => {
    expect(
      getPositionEventIdRange({
        cursor: null,
        fromBlock: 10n,
        toBlock: 12n,
      }),
    ).toEqual({
      minEventIdExclusive: EVENT_ID_OFFSET + 10n * EVENTS_PER_BLOCK - 1n,
      maxEventIdInclusive: EVENT_ID_OFFSET + 13n * EVENTS_PER_BLOCK - 1n,
    });
  });

  test("uses the cursor when it is later than fromBlock", () => {
    const cursor = EVENT_ID_OFFSET + 20n * EVENTS_PER_BLOCK + 123n;

    expect(
      getPositionEventIdRange({
        cursor,
        fromBlock: 10n,
        toBlock: null,
      }).minEventIdExclusive,
    ).toBe(cursor);
  });

  test("caps the last representable block at the signed event ID maximum", () => {
    expect(
      getPositionEventIdRange({
        cursor: null,
        fromBlock: null,
        toBlock: (1n << 32n) - 1n,
      }).maxEventIdInclusive,
    ).toBe(MAX_EVENT_ID);
  });
});
