// frontend/src/components/panes/hue/ColorTempSlider.tsx — Color temperature slider

import { useState, useRef, useCallback } from "react";
import { Thermometer } from "lucide-react";
import { sendAction } from "../../../lib/api-client";

interface Props {
  deviceId: string;
  currentCt: number;
  ctMin: number;
  ctMax: number;
  disabled?: boolean;
}

export function ColorTempSlider({ deviceId, currentCt, ctMin, ctMax, disabled }: Props) {
  const [localCt, setLocalCt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (value: number) => {
      setLocalCt(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        try {
          await sendAction(deviceId, "color-temp", { ct: value });
        } catch {}
        setLocalCt(null);
        debounceRef.current = null;
      }, 300);
    },
    [deviceId],
  );

  const displayCt = localCt ?? currentCt;

  // Gradient from cool (blue-ish) to warm (orange-ish)
  const gradientStyle = {
    background: `linear-gradient(to right, #A6C8FF, #FFD580, #FF9F43)`,
  };

  return (
    <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#6B7785] flex items-center gap-1">
          <Thermometer size={10} /> Color Temp
        </span>
        <span className="text-[10px] text-[#9AA6B2] font-mono">
          {displayCt} mirek
        </span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={gradientStyle}>
        <input
          type="range"
          min={ctMin}
          max={ctMax}
          value={displayCt}
          onChange={(e) => handleChange(Number(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-[#6B7785]">Cool</span>
        <span className="text-[9px] text-[#6B7785]">Warm</span>
      </div>
    </div>
  );
}
