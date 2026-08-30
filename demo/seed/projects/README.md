# Showcase Automation Project source

The public showcase uses the same Automation Project runtime and compiler as normal Aeolus authoring. The source here is deliberately held to a stronger presentation standard because visitors can open it directly from the dashboard.

## Showcase rule: Logic and UI are readable entry points

`logic/index.ts` and `ui/index.tsx` should be the easiest files in a project to read, but they should still tell the story of the project. They are composition roots, not implementation buckets and not six-line forwarding shims.

Think of the three editor surfaces this way:

- **Logic — “How does this automation think?”** Show trigger routing, the important policy/control sequence and calls to meaningful domain operations.
- **UI — “How does this automation present itself?”** Show the state being selected, the important operator intents and the high-level component composition.
- **Files — “How is all of that implemented?”** Put device lookup, verified-command mechanics, detailed calculations, persistence, demo fixtures, SVGs, charts, styling, animation and reusable components here.

For this showcase, 10–50 lines is a useful centre of gravity for an entry point. Some entries can be shorter or longer when that makes the flow clearer. Line count is a smell, not a target: a readable 60-line `main()` is better than a tiny shim that hides the automation.

Example Logic entry:

```ts
// logic/index.ts
import {
  handleWaterOperatorEvent,
  initialiseWaterState,
  isWaterTelemetry,
  projectWaterTelemetry,
  publishSourceReserve,
  reconcileBatchTransfer,
  reconcileWaterPolicy,
} from "./water-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseWaterState();

  if (topic.startsWith("ui/")) {
    await handleWaterOperatorEvent(event);
    return;
  }

  if (!isWaterTelemetry(topic)) return;

  const water = projectWaterTelemetry(topic);
  const pumpOn = await reconcileBatchTransfer(water);
  publishSourceReserve(water);
  await reconcileWaterPolicy(water, pumpOn);
}
```

Example UI entry:

```tsx
// ui/index.tsx
import WaterManagementDashboard from "./WaterManagementDashboard";

export default function WaterManagement(aeolus: CustomComponentProps) {
  const model = {
    damPct: aeolus.read("damPct"),
    headerPct: aeolus.read("headerPct"),
    pumpOn: aeolus.read("pumpOn"),
    batterySoc: aeolus.read("batterySoc"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    transfer500: () => aeolus.fire("transfer-500"),
    pumpStop: () => aeolus.fire("pump-stop"),
    reset: () => aeolus.fire("reset-water"),
  };

  return <WaterManagementDashboard model={model} actions={actions} />;
}
```

The supporting tree can then be as rich as the domain requires:

```text
logic/
  index.ts
  water-control.ts
  transfer.ts
  distribution.ts
  runtime.ts
ui/
  index.tsx
  WaterManagementDashboard.tsx
  WaterSchematic.tsx
  hooks.ts
```

## Why the showcase is stricter than the product

Aeolus still allows a genuinely small automation to live entirely in `logic/index.ts`, and a tiny custom component can live entirely in `ui/index.tsx`. The showcase deliberately exercises the multi-file project model because source architecture is part of what the demo is demonstrating.

When adding or changing a seeded project:

1. make Logic read like the automation's `main()` method;
2. make UI show state selection, important actions and high-level composition;
3. use domain names rather than generic files such as `helpers2.ts`;
4. keep device/ack plumbing, detailed maths and demo fixtures out of the entry point when they obscure the control flow;
5. keep substantial SVG, chart, styling and animation markup out of `ui/index.tsx`;
6. prefer clarity over arbitrary line-count minimisation;
7. run the seeded-project compile/architecture regression tests before committing.
