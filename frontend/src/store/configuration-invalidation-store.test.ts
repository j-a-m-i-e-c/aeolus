import { beforeEach, describe, expect, it } from "vitest";
import { useConfigurationInvalidationStore } from "./configuration-invalidation-store";

beforeEach(() => {
  useConfigurationInvalidationStore.setState({
    automationById: {},
    automationSequence: 0,
    reconcileSequence: 0,
  });
});

describe("configuration invalidation store", () => {
  it("retains the latest invalidation independently for each automation", () => {
    const initial = useConfigurationInvalidationStore.getState().automationSequence;
    useConfigurationInvalidationStore.getState().noteAutomation({
      id: "a1",
      revision: 2,
      deleted: false,
      mutationId: "m1",
    });
    useConfigurationInvalidationStore.getState().noteAutomation({
      id: "a2",
      revision: 4,
      deleted: true,
      mutationId: null,
    });

    const state = useConfigurationInvalidationStore.getState();
    expect(state.automationById.a1).toMatchObject({ id: "a1", revision: 2, deleted: false, mutationId: "m1" });
    expect(state.automationById.a2).toMatchObject({ id: "a2", revision: 4, deleted: true, mutationId: null });
    expect(state.automationById.a2.sequence).toBeGreaterThan(state.automationById.a1.sequence);
    expect(state.automationSequence).toBeGreaterThan(initial);
  });

  it("advances reconciliation without discarding automation invalidations", () => {
    useConfigurationInvalidationStore.getState().noteAutomation({ id: "a1", revision: 3, deleted: false });
    const before = useConfigurationInvalidationStore.getState().reconcileSequence;
    useConfigurationInvalidationStore.getState().noteReconcile();

    const state = useConfigurationInvalidationStore.getState();
    expect(state.reconcileSequence).toBeGreaterThan(before);
    expect(state.automationById.a1.revision).toBe(3);
  });
});
