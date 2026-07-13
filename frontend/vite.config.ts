/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/types/**",
        // e2e territory — high-effort / low-jsdom-fit; exercised by Playwright, not
        // unit tests.
        "src/components/ScriptEditor.tsx", // Monaco editor
        "src/components/UiEditor.tsx", // Monaco editor
        "src/lib/monaco-setup.ts", // Monaco worker/env wiring
        "src/components/MetricSparkline.tsx", // SVG chart
        "src/components/StateHistoryChart.tsx", // SVG chart
        "src/pages/data-store/TimeSeriesChart.tsx", // SVG chart
        "src/components/FlowDiagram.tsx", // node/edge flow diagram
        "src/components/panes/types.ts", // type-only module
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 75,
        branches: 70,
      },
    },
  },
});
