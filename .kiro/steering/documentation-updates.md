---
inclusion: auto
description: Rules for keeping the Aeolus documentation accurate without duplicating the same reference in several files
---

# Documentation update rules

## Authority

The code, schemas and tests are the final authority for exact behaviour.

Documentation should describe stable contracts and user-visible behaviour. Do not maintain a second handwritten copy of every class and file.

## Choose the correct document

### Public project story

Update `README.md` when:

- first-run commands or ports change;
- a major public capability changes;
- the documentation map changes;
- screenshots or the main architecture summary change.

Update `docs/WHAT_IS_AEOLUS.md` when the non-technical explanation changes.

Update `docs/WHY_AEOLUS.md` when the technical product thesis or major architecture rationale changes.

### Technical reference

Use the narrowest file under `docs/reference/`:

- `architecture.md`
- `automations.md`
- `connectors.md`
- `data-and-storage.md`
- `api.md`
- `dashboard.md`
- `operations.md`

Examples:

- new API route: update `reference/api.md`;
- new migration or storage contract: update `reference/data-and-storage.md`;
- sandbox or command semantics: update `reference/automations.md`;
- Docker, environment or CI changes: update `reference/operations.md`.

### Security

Use the appropriate file under `docs/security/` for authentication, tokens, permissions or MQTT security.

### Task guides

Update a how-to guide when the exact steps a user follows change.

### Developer guides

- connector contract: `src/connectors/README.md`
- testing process: `docs/TESTING.md`
- contribution process: `CONTRIBUTING.md`
- frontend design: `docs/BRANDING.md`

## Avoid duplication

Do not paste a full explanation into README, WHY and a reference file.

Prefer:

- one short summary;
- one direct link to the maintained detail.

Compatibility stubs such as `docs/AUTHENTICATION.md` only link to the split docs. Do not add new reference content to them.

## Definition of done

For a behaviour-changing change:

- implementation and tests agree;
- the relevant schema or type declarations are updated;
- the narrow relevant document is updated;
- setup examples still run;
- internal links remain valid;
- old claims are removed rather than contradicted elsewhere.

Pure refactors and test-only changes do not require documentation unless they change the development workflow.
