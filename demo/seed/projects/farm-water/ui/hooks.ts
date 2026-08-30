import { useEffect, useState } from "react";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useSmooth(value: number) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    let frame = 0;
    const from = display;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 18);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t >= 1) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [value]);
  return display;
}
