// frontend/src/test-setup.ts — global setup for Vitest (jsdom environment)
//
// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) and
// runs React Testing Library cleanup after every test so component trees don't
// leak between cases.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
