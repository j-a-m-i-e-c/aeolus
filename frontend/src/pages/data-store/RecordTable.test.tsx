// frontend/src/pages/data-store/RecordTable.test.tsx — paginated record table rendering & interactions

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordTable } from "./RecordTable";
import type { DataRecord } from "../../store/data-store-store";

function makeRecord(overrides: Partial<DataRecord> = {}): DataRecord {
  return {
    id: 1,
    collection: "energy",
    payload: { temp: 23, humidity: 45 },
    tags: {},
    timestamp: Date.UTC(2024, 0, 1, 12, 0, 0),
    ...overrides,
  };
}

describe("RecordTable", () => {
  it("shows the empty state when there are no records and not loading", () => {
    render(
      <RecordTable
        records={[]}
        total={0}
        loading={false}
        page={0}
        pageSize={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText("No records found")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a loading spinner (no table, no empty message) while loading", () => {
    render(
      <RecordTable
        records={[]}
        total={0}
        loading={true}
        page={0}
        pageSize={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("No records found")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders payload columns and values for populated records", () => {
    const records = [
      makeRecord({ id: 1, payload: { temp: 23, humidity: 45 } }),
      makeRecord({ id: 2, payload: { temp: 24, humidity: 50 } }),
    ];
    render(
      <RecordTable
        records={records}
        total={2}
        loading={false}
        page={0}
        pageSize={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("temp")).toBeInTheDocument();
    expect(screen.getByText("humidity")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("(2 total)")).toBeInTheDocument();
  });

  it("renders a Tags column and tag chips when records carry tags", () => {
    const records = [
      makeRecord({ id: 1, tags: { room: "kitchen" } }),
    ];
    render(
      <RecordTable
        records={records}
        total={1}
        loading={false}
        page={0}
        pageSize={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("room=kitchen")).toBeInTheDocument();
  });

  it("stringifies object payload values and dashes out missing ones", () => {
    const records = [
      makeRecord({ id: 1, payload: { meta: { a: 1 }, temp: 23 } }),
      makeRecord({ id: 2, payload: { temp: 24 } }), // no `meta` -> dash cell
    ];
    render(
      <RecordTable
        records={records}
        total={2}
        loading={false}
        page={0}
        pageSize={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("disables the previous button on the first page and pages forward", () => {
    const onPageChange = vi.fn();
    render(
      <RecordTable
        records={[makeRecord()]}
        total={100}
        loading={false}
        page={0}
        pageSize={50}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    const [prev, next] = screen.getAllByRole("button");
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables the next button on the last page and pages backward", () => {
    const onPageChange = vi.fn();
    render(
      <RecordTable
        records={[makeRecord()]}
        total={100}
        loading={false}
        page={1}
        pageSize={50}
        onPageChange={onPageChange}
      />,
    );
    const [prev, next] = screen.getAllByRole("button");
    expect(next).toBeDisabled();
    expect(prev).not.toBeDisabled();
    fireEvent.click(prev);
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
