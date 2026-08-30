# Technical reference

These documents describe how Aeolus is currently assembled. They are split by concern so one change does not require editing a single enormous manual.

## Reference map

- [Architecture](architecture.md)
- [Automation runtime](automations.md)
- [Connectors](connectors.md)
- [Data and storage](data-and-storage.md)
- [API and WebSocket](api.md)
- [Dashboard](dashboard.md)
- [Operations](operations.md)

For the product and design argument behind these choices, read [Why Aeolus?](../WHY_AEOLUS.md).

## How to use this reference

The reference explains stable runtime boundaries and public contracts. Source code, schemas and tests remain authoritative for exact types and edge cases.

Useful source entry points:

```text
src/index.ts
src/core/
src/automations/
src/connectors/
src/data-store/
src/api/routes/
src/websocket/
frontend/src/
```

These documents and the code are the current platform reference. Where older design notes survive elsewhere, they describe how a feature was planned rather than how it behaves today.
