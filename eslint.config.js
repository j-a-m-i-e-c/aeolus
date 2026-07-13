import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "frontend/dist/",
      "**/coverage/",
      // Playwright run artifacts
      "playwright-report/",
      "test-results/",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "consistent-return": "warn",
    },
  },
  // Relax rules for test files (includes React component tests, *.test.tsx)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.property.test.ts", "**/*.integration.test.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "consistent-return": "off",
    },
  },
  // Frontend (React + TSX) — adds JSX/hooks coverage the backend config lacked
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // React effects legitimately mix `return;` guards with `return () => cleanup`,
      // which this rule flags as inconsistent. TS return types cover the real cases.
      "consistent-return": "off",
    },
  },
  // The custom-UI type shim mirrors React's own upstream typings (IntrinsicElements
  // catch-all, FC/hook generics), which are intentionally `any`. Scope the exemption
  // to that file so `any` is still caught in every other declaration file.
  {
    files: ["**/ui-types.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
