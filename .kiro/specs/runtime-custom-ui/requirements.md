# Requirements Document

## Introduction

Aeolus currently compiles custom automation UI components (TSX) into the frontend Vite bundle via a Docker rebuild. This takes 1–3 minutes on a Raspberry Pi, requires `--no-cache` to avoid stale Docker COPY caches, and forces users to wait after every save. The runtime-custom-ui feature replaces this build-time approach with a runtime loading model: the backend transpiles TSX to ES module JavaScript at save time, stores the compiled output, serves it via an API endpoint, and the frontend loads it dynamically — eliminating the Docker rebuild entirely.

## Glossary

- **TSX_Transpiler**: The backend module that converts TSX source code into ES module JavaScript using the TypeScript compiler API with JSX support enabled. Extends the existing `transpiler.ts`.
- **UI_Module_Endpoint**: The REST API endpoint (`GET /api/automations/:id/ui-module`) that serves the compiled JavaScript module for a given automation rule.
- **Dynamic_Loader**: The frontend module that fetches compiled JavaScript from the UI_Module_Endpoint and instantiates it as a live React component at runtime using blob URLs and dynamic `import()`.
- **Compiled_UI**: The `compiled_ui` column in the `automation_rules` database table that stores the transpiled ES module JavaScript alongside the TSX source (`ui_source`).
- **CustomComponentProps**: The existing interface (`frontend/src/components/panes/custom/types.ts`) defining the props contract between the Aeolus runtime and custom UI components.
- **CustomComponentBoundary**: The existing React error boundary component that catches rendering errors in custom UI components and provides a fallback view.
- **AutomationPane**: The frontend pane component that renders automation status, editing, and custom UI components within the dashboard.
- **CustomUiManager**: The existing backend class that writes TSX files to disk and regenerates the static import registry. To be removed by this feature.
- **External_Dependencies**: Libraries (React, ReactDOM) that compiled UI modules reference as imports and that must be available at runtime without bundling them into each module.

## Requirements

### Requirement 1: TSX-to-ES-Module Transpilation

**User Story:** As a user, I want my custom UI component TSX to be transpiled into a loadable ES module when I save, so that the component is ready to render without a Docker rebuild.

#### Acceptance Criteria

1. WHEN a TSX source string is provided, THE TSX_Transpiler SHALL transpile it into ES module JavaScript using the TypeScript compiler API with `jsx` set to `react-jsx` and `module` set to `ESNext`.
2. WHEN the TSX source contains syntax errors, THE TSX_Transpiler SHALL return structured error objects containing line number, column number, and error message for each diagnostic.
3. WHEN the TSX source is an empty string, THE TSX_Transpiler SHALL return an error indicating that the source cannot be empty.
4. THE TSX_Transpiler SHALL preserve the default export of the component so that the Dynamic_Loader can extract it after import.
5. WHEN the TSX source contains `import` statements for React or JSX runtime modules, THE TSX_Transpiler SHALL allow those imports (unlike the automation script transpiler which rejects all imports).
6. FOR ALL valid TSX source strings, transpiling and then parsing the output as an ES module SHALL produce syntactically valid JavaScript (round-trip property).

### Requirement 2: Compiled UI Storage

**User Story:** As a user, I want my compiled UI module to be persisted in the database, so that it survives restarts and can be served without re-transpilation.

#### Acceptance Criteria

1. WHEN an automation rule is created with a `uiSource` field, THE API SHALL transpile the TSX using the TSX_Transpiler and store the result in the Compiled_UI column.
2. WHEN an automation rule is updated with a new `uiSource` field, THE API SHALL re-transpile the TSX and update the Compiled_UI column.
3. WHEN an automation rule's `uiSource` is cleared (set to empty string or null), THE API SHALL set the Compiled_UI column to null.
4. WHEN TSX transpilation fails during create or update, THE API SHALL return a 400 response with structured error details and SHALL NOT modify the Compiled_UI column.
5. THE API SHALL add the `compiled_ui` column to the `automation_rules` table via a migration that does not break existing rows.

### Requirement 3: UI Module Serving Endpoint

**User Story:** As a frontend developer, I want an API endpoint that serves the compiled JavaScript module for a given automation, so that the frontend can load it at runtime.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/automations/:id/ui-module` for a rule with a Compiled_UI value, THE UI_Module_Endpoint SHALL respond with the compiled JavaScript and a `Content-Type` header of `application/javascript`.
2. WHEN a GET request is made to `/api/automations/:id/ui-module` for a rule without a Compiled_UI value, THE UI_Module_Endpoint SHALL respond with a 404 status code.
3. WHEN a GET request is made to `/api/automations/:id/ui-module` for a non-existent rule, THE UI_Module_Endpoint SHALL respond with a 404 status code.
4. THE UI_Module_Endpoint SHALL include a `Cache-Control: no-cache` header so that the frontend always fetches the latest compiled module after a save.

### Requirement 4: Frontend Dynamic Component Loading

**User Story:** As a user, I want my custom UI component to appear in the dashboard immediately after saving, so that I do not have to rebuild or refresh the page.

#### Acceptance Criteria

1. WHEN the AutomationPane renders in status mode for a rule with a `uiSource` field, THE Dynamic_Loader SHALL fetch the compiled module from the UI_Module_Endpoint.
2. WHEN the compiled module is fetched successfully, THE Dynamic_Loader SHALL create a blob URL, dynamically import it, and extract the default export as a React component.
3. WHEN the dynamic import fails or the module has no default export, THE Dynamic_Loader SHALL display an error message within the CustomComponentBoundary fallback.
4. THE Dynamic_Loader SHALL make React and ReactDOM available to the loaded module as external dependencies so that JSX rendering functions resolve correctly.
5. WHEN the user saves an updated `uiSource` and returns to status mode, THE Dynamic_Loader SHALL re-fetch the compiled module from the UI_Module_Endpoint to display the latest version.
6. WHILE the compiled module is being fetched, THE AutomationPane SHALL display a loading indicator.

### Requirement 5: External Dependency Resolution

**User Story:** As a user writing custom TSX components, I want to use React hooks and JSX without bundling React into every component, so that modules remain small and share the host application's React instance.

#### Acceptance Criteria

1. THE TSX_Transpiler SHALL configure the JSX transform to emit `react-jsx` runtime imports (e.g., `import { jsx } from "react/jsx-runtime"`).
2. THE Dynamic_Loader SHALL intercept module import specifiers for `react`, `react-dom`, and `react/jsx-runtime` and resolve them to the host application's instances of those libraries.
3. WHEN a compiled module references an import specifier that is not in the set of provided externals, THE Dynamic_Loader SHALL allow the import to fail naturally and THE CustomComponentBoundary SHALL catch the resulting render error.

### Requirement 6: Removal of Build-Time Custom UI Pipeline

**User Story:** As a developer, I want the old file-based custom UI pipeline removed, so that there is a single code path for custom components and no stale rebuild artifacts.

#### Acceptance Criteria

1. THE API SHALL stop calling CustomUiManager methods (`writeComponent`, `deleteComponent`, `regenerateRegistry`) during automation create, update, and delete operations.
2. THE AutomationPane SHALL remove the "Rebuild Frontend" button, rebuild status polling, and the "Custom UI saved — rebuild frontend to activate" banner.
3. THE AutomationPane SHALL remove the static import of `CUSTOM_COMPONENTS` from `./custom/index` and replace it with the Dynamic_Loader for rendering custom components.
4. THE system routes SHALL remove the `POST /api/system/rebuild-frontend` and `GET /api/system/rebuild-status` endpoints.
5. THE backend SHALL remove the `CustomUiManager` class and its instantiation from the application startup.

### Requirement 7: Error Handling and Resilience

**User Story:** As a user, I want clear feedback when my custom component has errors, so that I can fix issues without the dashboard breaking.

#### Acceptance Criteria

1. WHEN a dynamically loaded component throws a runtime error during rendering, THE CustomComponentBoundary SHALL catch the error and display the error message with a "Show Default View" fallback button.
2. WHEN the UI_Module_Endpoint returns a non-200 response, THE Dynamic_Loader SHALL display a descriptive error message in the pane instead of a blank area.
3. WHEN the compiled module's default export is not a valid React component (not a function), THE Dynamic_Loader SHALL display an error indicating the module does not export a valid component.
4. IF the network request to the UI_Module_Endpoint times out or fails, THEN THE Dynamic_Loader SHALL display a connection error message and provide a retry mechanism.
