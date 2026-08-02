// src/connectors/kasa/kasa-power-state.ts — canonical Kasa on/off resolution

/**
 * Subset of the tplink-smarthome-api `sysInfo` shape that Aeolus reads to
 * determine a device's power state.
 *
 * Plugs and switches report `relay_state` (0/1). Bulbs report their on/off
 * under `light_state.on_off` (0/1) and generally have no `relay_state`.
 */
export interface KasaSysInfo {
  relay_state?: number;
  light_state?: { on_off?: number };
}

/**
 * Resolve the on/off state for any Kasa device from its `sysInfo`.
 *
 * This is the single source of truth used by both discovery (`mapDevice`) and
 * action execution (`toggle`) so plugs and bulbs are interpreted identically.
 *
 * Precedence:
 * - When `light_state.on_off` is present (a bulb), power state is
 *   `light_state.on_off === 1`.
 * - Otherwise (a plug/switch), power state is `relay_state === 1`.
 * - When neither is present, power state is `false`.
 *
 * @param sysInfo - The device's raw `sysInfo`, or undefined.
 * @returns `true` when the device is on, `false` otherwise. Never throws.
 */
export function kasaPowerState(sysInfo: KasaSysInfo | undefined): boolean {
  const lightOnOff = sysInfo?.light_state?.on_off;
  if (lightOnOff !== undefined) {
    return lightOnOff === 1;
  }
  return sysInfo?.relay_state === 1;
}
