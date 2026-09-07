import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const store = vi.hoisted(() => ({
  timeRange: "24h",
  setTimeRange: vi.fn(),
}));

vi.mock("../../store/data-store-store", async () => {
  const actual = await vi.importActual<typeof import("../../store/data-store-store")>("../../store/data-store-store");
  return {
    ...actual,
    useDataStoreStore: (selector: (s: typeof store) => unknown) => selector(store),
  };
});

import { TimeSeriesChart } from "./TimeSeriesChart";

describe("TimeSeriesChart", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("does not treat a payload timestamp as a numeric measurement series", () => {
    render(
      <TimeSeriesChart
        records={[
          {
            id: 1,
            collection: "tank-levels",
            timestamp: 1_700_000_000_000,
            tags: {},
            payload: { timestamp: 1_700_000_000_000, header: 58, shedCatchment: 72 },
          },
          {
            id: 2,
            collection: "tank-levels",
            timestamp: 1_700_000_300_000,
            tags: {},
            payload: { timestamp: 1_700_000_300_000, header: 60, shedCatchment: 71 },
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /header/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shedCatchment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^timestamp$/i })).not.toBeInTheDocument();
  });

  /** Two readings `days` apart, at the same clock time each day. */
  function spanningRecords(days: number) {
    const start = Date.UTC(2026, 7, 12, 8, 0, 0); // 12 Aug 2026, 08:00
    return [
      { id: 1, collection: "c", timestamp: start, tags: {}, payload: { header: 58 } },
      { id: 2, collection: "c", timestamp: start + days * 86_400_000, tags: {}, payload: { header: 60 } },
    ];
  }

  // A time-only axis label on a multi-day range renders as "8:00 AM" repeated with
  // nothing to say which day each tick is. Harmless while the chart only drew the
  // newest few hours; misleading once the range is actually honoured.
  it("labels the axis with dates once the span exceeds a day", () => {
    const { container } = render(<TimeSeriesChart records={spanningRecords(30)} />);
    const labels = Array.from(container.querySelectorAll("text")).map((n) => n.textContent ?? "");

    expect(labels.some((l) => /\b(Aug|Sep)\b/.test(l))).toBe(true);
    // No tick may be a bare clock time, which is what lost the date.
    expect(labels.some((l) => /^\d{1,2}:\d{2}(\s?[AP]M)?$/.test(l.trim()))).toBe(false);
  });

  it("keeps relative labels for a span inside a day", () => {
    const now = Date.now();
    const records = [
      { id: 1, collection: "c", timestamp: now - 6 * 3_600_000, tags: {}, payload: { header: 58 } },
      { id: 2, collection: "c", timestamp: now, tags: {}, payload: { header: 60 } },
    ];
    const { container } = render(<TimeSeriesChart records={records} />);
    const labels = Array.from(container.querySelectorAll("text")).map((n) => n.textContent ?? "");

    expect(labels.some((l) => /ago|now/.test(l))).toBe(true);
    expect(labels.some((l) => /\b(Aug|Sep|Jan)\b/.test(l))).toBe(false);
  });
});
