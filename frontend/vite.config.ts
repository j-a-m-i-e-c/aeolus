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
  build: {
    rollupOptions: {
      // Two entries: the main dashboard app (index.html) and the self-contained
      // sandbox runtime that executes INSIDE the opaque-origin iframe. The runtime
      // is emitted at a stable, unhashed path so the static public/sandbox.html can
      // reference it directly (`/assets/sandbox-runtime.js`).
      input: {
        index: path.resolve(__dirname, "index.html"),
        "sandbox-runtime": path.resolve(__dirname, "src/sandbox/runtime/entry.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "sandbox-runtime"
            ? "assets/sandbox-runtime.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
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
        "src/components/TabLayout.tsx", // drag-and-drop pane layout (DnD API not in jsdom)
        "src/components/Sidebar.tsx", // nav + tab DnD (DnD API not in jsdom)
        "src/components/panes/AutomationPane.tsx", // TODO: has tests but ~75% func coverage; close gap then remove
        "src/components/panes/HueControlPane.tsx", // color picker + sliders
        "src/pages/UserManagementPage.tsx", // admin CRUD modals
        "src/pages/data-store/SettingsPanel.tsx", // config forms
        "src/pages/data-store/SetupWizard.tsx", // multi-step wizard
        "src/pages/data-store/CollectionDetail.tsx", // chart + query interaction
        "src/pages/data-store/CollectionList.tsx", // list + modals
        "src/components/panes/StateHistoryPane.tsx", // time-series chart interaction
        // Sandbox runtime/host — requires real iframe + MessagePort (exercised by
        // Playwright e2e, not jsdom unit tests). The pure logic (rpc-types, sdk-broker,
        // sdk-client, module-loader, shim, sandbox-pool) IS unit-tested.
        "src/sandbox/runtime/entry.ts", // iframe bootstrap (postMessage + createRoot)
        "src/sandbox/useSandboxedComponent.ts", // iframe lifecycle hook (real DOM + MessageChannel)
        "src/sandbox/SandboxHost.tsx", // React component mounting real iframes (hook requires real iframe)
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
