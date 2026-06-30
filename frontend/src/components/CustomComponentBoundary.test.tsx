// frontend/src/components/CustomComponentBoundary.test.tsx — Error boundary behaviour

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomComponentBoundary } from "./CustomComponentBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

describe("CustomComponentBoundary", () => {
  beforeEach(() => {
    // React logs caught render errors to console.error; silence the noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when they do not throw", () => {
    render(
      <CustomComponentBoundary onFallback={vi.fn()}>
        <div>healthy child</div>
      </CustomComponentBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  it("renders the fallback with the error message when a child throws", () => {
    render(
      <CustomComponentBoundary onFallback={vi.fn()}>
        <Boom />
      </CustomComponentBoundary>,
    );
    expect(screen.getByText("Custom component error")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
  });

  it("invokes onFallback when the recovery button is clicked", () => {
    const onFallback = vi.fn();
    render(
      <CustomComponentBoundary onFallback={onFallback}>
        <Boom />
      </CustomComponentBoundary>,
    );
    fireEvent.click(screen.getByText("Show Default View"));
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
