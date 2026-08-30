# ADR-0006: One command boundary with evidence-based completion tiers

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

In physical systems, "the API call returned" is not the same as "the device did the thing". Different equipment can prove different levels of completion: some transports can only prove dispatch, some return correlated acknowledgements, and some can be confirmed by subsequently observed state.

If each connector or automation invented its own success semantics, Aeolus could report false confidence and automation sequencing would be unreliable.

## Decision

Route device actions through a **single command service/lifecycle**. Track monotonic command states from request through dispatch and, where supported, acknowledgement and observation. Expose three confirmation tiers:

- `dispatch`
- `acknowledged`
- `observed`

A command resolves against the strongest tier the target device can actually prove unless the caller requests a valid lower/specific tier. The command boundary clamps requests to live device capability and records durable command history. Timeouts, failures and state mismatches remain explicit outcomes rather than being converted into generic success.

## Why this fits Aeolus

Aeolus' differentiator is not merely sending commands; it is being truthful about what is known to have happened in the physical world. A central lifecycle makes that semantic consistent across MQTT devices and connectors and lets automation actions sequence on real outcomes.

## Alternatives considered

### Treat successful transport dispatch as success

This is common and simple, but it conflates "message sent" with "device acted" and makes failures invisible whenever the transport accepts the command.

### Require acknowledgements from every device

Many devices cannot provide correlated acknowledgements. Making ACK mandatory would exclude useful equipment or force unreliable synthetic acknowledgements.

### Store one completion level per automation

One automation can command heterogeneous devices. A rule-level tier would be an aspiration that must be silently weakened for some targets. Per-command/device capability is more truthful.

## Consequences

### Positive

- Command results communicate evidence rather than optimism.
- MQTT and connector actions share lifecycle semantics.
- Automations can fail fast when a physical action does not reach its required outcome.
- Durable history makes incidents explainable.

### Negative / accepted trade-offs

- Correlation, timeout and observation tracking add substantial state-machine complexity.
- Device capability metadata must be accurate.
- Late and duplicate acknowledgements must be handled idempotently.
- Tests need to cover timing/race behaviour, not only happy paths.

## Revisit when

Revisit the vocabulary if industrial protocols require richer evidence states, but preserve the principle that reported success must never exceed evidence the target path can prove.

## Implementation anchors

- `src/automations/command-service.ts`
- `src/automations/command-lifecycle.ts`
- `src/automations/pending-command-tracker.ts`
- `src/automations/command-history-store.ts`
- `src/automations/completion-tier.ts`
- `docs/reference/automations.md`
