import { describe, expect, test } from "bun:test";
import { StatusError } from "../../shared/errors";
import { MAX_NET_FLOW_BUCKETS, netFlowWindow } from "./netFlow";

describe("netFlowWindow", () => {
  test("ends now, truncated to the second, and spans the duration", () => {
    const { start, end } = netFlowWindow(1_761_480_000_999, 1_800, 86_400);
    expect(end.getTime()).toBe(1_761_480_000_000);
    expect(start.getTime()).toBe(1_761_393_600_000);
  });

  test.each([
    [1_800, 86_400],
    [14_400, 604_800],
    [43_200, 2_592_000],
  ])("accepts the chart's %i/%i request", (interval, duration) => {
    expect(() => netFlowWindow(0, interval, duration)).not.toThrow();
  });

  test("accepts exactly the bucket limit and rejects one more", () => {
    expect(() => netFlowWindow(0, 60, 60 * MAX_NET_FLOW_BUCKETS)).not.toThrow();
    expect(() => netFlowWindow(0, 60, 60 * MAX_NET_FLOW_BUCKETS + 1)).toThrow(
      StatusError,
    );
  });
});
