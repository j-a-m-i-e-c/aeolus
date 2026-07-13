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
        // Complex interactive pages — exercised via Playwright e2e and manual testing.
        // Their many event handlers (modals, forms, drag-and-drop) are not practical
        // to unit-test in jsdom and provide minimal value over e2e coverage.
        "src/components/SystemPage.tsx", // system diagnostics + Docker controls
        "src/components/ConnectorsPage.tsx", // multi-step setup wizards
        "src/components/AutomationsPage.tsx", // Monaco + script execution
        "src/components/DeviceDetail.tsx", // device action execution
        "src/components/TabLayout.tsx", // drag-and-drop pane layout
        "src/components/Sidebar.tsx", // nav + tab DnD
        "src/components/panes/AutomationPane.tsx", // script editor integration
        "src/components/panes/HueControlPane.tsx", // color picker + sliders
        "src/components/panes/KasaControlPane.tsx", // device control with actions
        "src/pages/UserManagementPage.tsx", // admin CRUD modals
        "src/pages/data-store/SettingsPanel.tsx", // config forms
        "src/pages/data-store/SetupWizard.tsx", // multi-step wizard
        "src/pages/data-store/CollectionDetail.tsx", // chart + query interaction
        "src/pages/data-store/CollectionList.tsx", // list + modals
        "src/pages/data-store/DataExplorer.tsx", // tab navigation + query builder
        "src/components/CommandPalette.tsx", // keyboard shortcut modal
        "src/components/SnippetPicker.tsx", // code snippet insertion
        "src/components/panes/StateHistoryPane.tsx", // time-series chart interaction
        "src/components/panes/UiTriggerButtonPane.tsx", // action dispatch UI
        "src/hooks/useDynamicComponent.ts", // dynamic import (covered by rewriteImports test)
        "src/components/panes/MqttViewerPane.tsx", // MQTT message stream
        "src/components/panes/hue/HueTempSlider.tsx", // Hue slider
        "src/components/UserSelector.tsx", // user selection modal
        "src/pages/ManagementPage.tsx", // admin management page
        "src/components/InsightsButton.tsx", // AI insights button
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
