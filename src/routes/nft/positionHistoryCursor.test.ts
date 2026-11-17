import { describe, expect, test } from "bun:test";
import { app } from "../../router";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  type HistoryCursor,
} from "./positionHistoryCursor";

const cursor: HistoryCursor = {
  v: 1,
  chain_id: "1",
  locker: "10",
  id: "42",
  limit: 25,
  snapshot: { block_number: "10", block_hash: "1", fork_counter: "0" },
  last_nonempty_block: "10",
  event_id: (-(1n << 63n) + (10n << 32n) + 1n).toString(),
  source_type: 3,
};
const path = "http://localhost/positions/1/10/42/history/page";

describe("position history cursor", () => {
  test("round-trips the signed event key and preserves decimal precision", () => {
    const encoded = encodeHistoryCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeHistoryCursor(encoded, cursor)).toEqual(cursor);
  });

  test("rejects inconsistent scope, keys outside the fence and noncanonical encodings", () => {
    const encoded = encodeHistoryCursor(cursor);
    expect(() => decodeHistoryCursor(encoded, { ...cursor, id: "43" })).toThrow(
      "Invalid history cursor",
    );
    expect(() =>
      decodeHistoryCursor(encoded, { ...cursor, limit: 100 }),
    ).toThrow("Invalid history cursor");
    for (const bad of [
      `${encoded}=`,
      encodeHistoryCursor({ ...cursor, event_id: "0" }),
      btoa(JSON.stringify({ ...cursor, v: 2 })),
      btoa(JSON.stringify({ ...cursor, extra: true })),
    ]) {
      expect(() => decodeHistoryCursor(bad, cursor)).toThrow(
        "Invalid history cursor",
      );
    }
  });

  test("rejects bad pagination queries before opening a database connection", async () => {
    for (const query of [
      "limit=0",
      "limit=-1",
      "limit=101",
      "limit=1e1",
      "limit=1.0",
      "limit=%201",
      "limit=0x1",
      "limit=1&limit=1",
      "cursor=bad",
      "cursor=",
      `cursor=${"a".repeat(2049)}`,
    ]) {
      const response = await app.request(`${path}?${query}`, undefined, {});
      expect(response.status).toBe(400);
    }
  });
});
