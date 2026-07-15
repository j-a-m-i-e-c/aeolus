/* eslint-disable react-refresh/only-export-components -- sandbox runtime bundle, not hot-reloaded */
// frontend/src/sandbox/runtime/shim.tsx — Compatibility shim (runs INSIDE the frame)
//
// Reconstructs the exact props object an author's component expects
// (CustomComponentProps for automations, CustomPanelProps for panels) and routes
// every call through the Aeolus UI SDK over the RPC channel. A small in-frame
// wrapper component subscribes to state/props updates and forces a re-render so
// the experience matches the current in-page behavior (reactive re-render,
// preserved props surface, equivalent save/fire semantics).

import { useEffect, useState, createElement, type ComponentType, type ReactElement } from "react";
import type { AeolusUiSdk } from "./sdk-client";
import type { CustomComponentProps } from "../../components/panes/custom/types";
import type { EntityType, PropsPayload } from "../rpc-types";

/**
 * Custom panel props shape (per the `custom-panels` spec). Defined locally here
 * because the panel type module does not yet exist in the repo; the panel render
 * path is made ready without introducing an orphaned import.
 */
export interface CustomPanelProps {
  devices: PropsPayload["devices"];
  panelId: string;
  panelName: string;
  deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  mqttPublish: (topic: string, payload: string) => void;
  state: Map<string, unknown>;
  stateSet: (key: string, value: unknown) => void;
}

/**
 * Build the exact CustomComponentProps object an automation UI component expects.
 * `read` is synchronous (served from the SDK's local mirror). `save`/`saveAndFire`/
 * `fire`/`publish` are fire-and-forget (matching current behavior). `control`
 * returns the SDK Promise so `await aeolus.control(...)` resolves after the host
 * round-trip.
 */
export function buildAutomationProps(sdk: AeolusUiSdk): CustomComponentProps {
  const snapshot = sdk.getProps();
  return {
    devices: snapshot.devices,
    ruleId: snapshot.ruleId,
    ruleName: snapshot.ruleName,
    lastFired: snapshot.lastFired,
    enabled: snapshot.enabled,
    history: snapshot.history,
    read: (key: string) => sdk.read(key),
    save: (key: string, value: unknown) => void sdk.save(key, value),
    saveAndFire: (key: string, value: unknown) => void sdk.saveAndFire(key, value),
    fire: (eventName: string, payload?: Record<string, unknown>) => void sdk.fire(eventName, payload),
    control: (deviceId: string, actionType: string, params?: Record<string, unknown>) =>
      sdk.control(deviceId, actionType, params),
    publish: (topic: string, payload: string) => void sdk.publish(topic, payload),
  };
}

/**
 * Build the CustomPanelProps object a panel UI component expects, mapping onto the
 * same SDK: deviceAction → control, mqttPublish → publish, state → mirrored Map,
 * stateSet → save.
 */
export function buildPanelProps(sdk: AeolusUiSdk): CustomPanelProps {
  const snapshot = sdk.getProps();
  const stateMap = new Map<string, unknown>(Object.entries(snapshot.state ?? {}));
  return {
    devices: snapshot.devices,
    panelId: snapshot.ruleId,
    panelName: snapshot.ruleName,
    deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) =>
      sdk.control(deviceId, actionType, params),
    mqttPublish: (topic: string, payload: string) => void sdk.publish(topic, payload),
    state: stateMap,
    stateSet: (key: string, value: unknown) => void sdk.save(key, value),
  };
}

interface ShimHostProps {
  sdk: AeolusUiSdk;
  entityType: EntityType;
  Component: ComponentType<Record<string, unknown>>;
}

/**
 * In-frame wrapper that renders the author's component with reconstructed props
 * and re-renders whenever a subscribed state value or a props patch arrives.
 */
export function ShimHost({ sdk, entityType, Component }: ShimHostProps): ReactElement {
  // A monotonically-increasing version bumped on any state/props change forces a
  // re-render so `read(key)` / `getProps()` reflect the latest mirrored values.
  const [, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubscribeState = sdk.subscribeState(() => bump());
    const unsubscribeProps = sdk.subscribeProps(() => bump());
    return () => {
      unsubscribeState();
      unsubscribeProps();
    };
  }, [sdk]);

  const props =
    entityType === "automation"
      ? (buildAutomationProps(sdk) as unknown as Record<string, unknown>)
      : (buildPanelProps(sdk) as unknown as Record<string, unknown>);

  return createElement(Component, props);
}
