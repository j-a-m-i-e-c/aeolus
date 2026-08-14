import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: "src/",
    include: [
      "**/*.test.ts",
      "**/*.property.test.ts",
      "__integration__/**/*.integration.test.ts",
    ],
    testTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover"],
      reportsDirectory: "./coverage",
      include: ["**/*.ts"],
      exclude: [
        "index.ts",
        "connectors/_template/**",
        "coverage/**",
        "**/*.test.ts",
        "**/*.property.test.ts",
        "__integration__/**",
        "__test-helpers__/**",
        "node_modules/**",
        "**/*.d.ts",
        "automations/sandbox.ts",
        "types/**",
        "core/types.ts",
        "api/schemas/**",
        "automations/transpiler.ts",
        "connectors/connector.interface.ts",
        "services/service.interface.ts",
        "db/migration-errors.ts",
        "db/database.ts",
        "db/migration-runner.ts",
        // Simulator scenarios are demo/integration FIXTURES: illustrative device
        // models with heavy command-validation and fault-injection branching.
        // Their behaviour is covered by the scenario tests, but they are not
        // product runtime, so exclude them from the coverage metric (paths here
        // are relative to the `src/` coverage root).
        "simulator/scenarios/**",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        "src/core/": { lines: 85 },
        "src/mqtt/": { lines: 80 },
        "src/data-store/": { lines: 80 },
        "src/automations/": { lines: 50 },
      },
    },
  },
});
