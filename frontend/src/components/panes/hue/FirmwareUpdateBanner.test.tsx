// frontend/src/components/panes/hue/FirmwareUpdateBanner.test.tsx — Firmware banner messaging

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirmwareUpdateBanner } from "./FirmwareUpdateBanner";

describe("FirmwareUpdateBanner", () => {
  it("renders nothing when no updates are available", () => {
    const { container } = render(<FirmwareUpdateBanner updatesAvailable={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the bridge-specific message", () => {
    render(<FirmwareUpdateBanner updatesAvailable updateType="bridge" />);
    expect(
      screen.getByText("Bridge firmware update available — open the Hue app to install"),
    ).toBeInTheDocument();
  });

  it("shows the lights-specific message", () => {
    render(<FirmwareUpdateBanner updatesAvailable updateType="lights" />);
    expect(
      screen.getByText("Light updates available — open the Hue app to install"),
    ).toBeInTheDocument();
  });

  it("shows the combined message", () => {
    render(<FirmwareUpdateBanner updatesAvailable updateType="both" />);
    expect(
      screen.getByText("Bridge and light updates available — open the Hue app to install"),
    ).toBeInTheDocument();
  });

  it("falls back to a generic message when no type is given", () => {
    render(<FirmwareUpdateBanner updatesAvailable />);
    expect(
      screen.getByText("Firmware updates available — open the Hue app to install"),
    ).toBeInTheDocument();
  });
});
