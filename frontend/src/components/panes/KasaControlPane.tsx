// frontend/src/components/panes/KasaControlPane.tsx — Kasa device control pane

import { Plug, Zap } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useDeviceStore } from "../../store/device-store";
import { sendAction } from "../../lib/api-client";

interface Props {
  config: PaneConfig;
}

function deviceTypeBadge(type: string): string {
  switch (type) {
    case "light":
      return "Light";
    case "switch":
      return "Switch";
    default:
      return "Plug";
  }
}

export function KasaControlPane({ config: _config }: Props) {
  const devices = useDeviceStore((s) => s.devices);
  const updateDevice = useDeviceStore((s) => s.updateDevice);

  const kasaDevices = Object.values(devices).filter(
    (d) => d.integration === "kasa",
  );

  const handleToggle = async (deviceId: string, currentOn: boolean) => {
    updateDevice(deviceId, { on: !currentOn });
    try {
      await sendAction(deviceId, "toggle");
    } catch {
      updateDevice(deviceId, { on: currentOn });
    }
  };

  if (kasaDevices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[#6B7785]">
        <Plug size={32} className="mb-3 opacity-40" />
        <p className="text-sm">No Kasa devices found.</p>
        <p className="text-xs mt-1">Enable the Kasa connector on the Connectors page.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {kasaDevices.map((device) => {
        const isOn = Boolean(device.state.on);
        const online = device.state.online !== false && device.state.reachable !== false;
        const hasEnergy =
          device.state.voltage !== undefined ||
          device.state.current !== undefined ||
          device.state.power !== undefined ||
          device.state.totalConsumption !== undefined;

        return (
          <div
            key={device.id}
            className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug size={16} className={isOn ? "text-primary" : "text-[#6B7785]"} />
                <span className="text-sm font-medium text-[#E6EDF3]">{device.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-[#6B7785]">
                  {deviceTypeBadge(device.type)}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    online
                      ? "bg-[#22C55E]/20 text-[#22C55E]"
                      : "bg-[#EF4444]/20 text-[#EF4444]"
                  }`}
                >
                  {online ? "online" : "offline"}
                </span>
              </div>
            </div>

            {/* Toggle */}
            <button
              onClick={() => handleToggle(device.id, isOn)}
              className={`w-full py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                isOn
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2]"
              }`}
            >
              {isOn ? "Turn Off" : "Turn On"}
            </button>

            {/* Energy stats */}
            {hasEnergy && (
              <div className="border-t border-[#2A3441] pt-2">
                <div className="flex items-center gap-1 mb-2">
                  <Zap size={10} className="text-[#F59E0B]" />
                  <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                    Energy
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {device.state.voltage !== undefined && (
                    <div>
                      <div className="text-[10px] text-[#6B7785]">Voltage</div>
                      <div className="text-[#E6EDF3] font-mono">
                        {Number(device.state.voltage).toFixed(1)}V
                      </div>
                    </div>
                  )}
                  {device.state.current !== undefined && (
                    <div>
                      <div className="text-[10px] text-[#6B7785]">Current</div>
                      <div className="text-[#E6EDF3] font-mono">
                        {Number(device.state.current).toFixed(2)}A
                      </div>
                    </div>
                  )}
                  {device.state.power !== undefined && (
                    <div>
                      <div className="text-[10px] text-[#6B7785]">Power</div>
                      <div className="text-[#E6EDF3] font-mono">
                        {Number(device.state.power).toFixed(1)}W
                      </div>
                    </div>
                  )}
                  {device.state.totalConsumption !== undefined && (
                    <div>
                      <div className="text-[10px] text-[#6B7785]">Total</div>
                      <div className="text-[#E6EDF3] font-mono">
                        {Number(device.state.totalConsumption).toFixed(2)}kWh
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
