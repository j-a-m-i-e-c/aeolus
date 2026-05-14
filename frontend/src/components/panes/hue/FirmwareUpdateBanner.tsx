// frontend/src/components/panes/hue/FirmwareUpdateBanner.tsx — Firmware update notification

import { Info } from "lucide-react";

interface Props {
  updatesAvailable: boolean;
  updateType?: "bridge" | "lights" | "both";
}

export function FirmwareUpdateBanner({ updatesAvailable, updateType }: Props) {
  if (!updatesAvailable) {
    return null;
  }

  let message: string;
  switch (updateType) {
    case "bridge":
      message = "Bridge firmware update available — open the Hue app to install";
      break;
    case "lights":
      message = "Light updates available — open the Hue app to install";
      break;
    case "both":
      message = "Bridge and light updates available — open the Hue app to install";
      break;
    default:
      message = "Firmware updates available — open the Hue app to install";
      break;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
      <Info size={14} className="text-[#F59E0B] shrink-0" />
      <p className="text-[11px] text-[#F59E0B]">{message}</p>
    </div>
  );
}
