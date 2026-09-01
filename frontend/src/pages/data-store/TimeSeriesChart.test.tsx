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
});
