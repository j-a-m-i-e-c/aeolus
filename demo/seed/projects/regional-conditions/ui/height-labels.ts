// Place numeric gauge-height labels without covering neighbouring station markers.
// Every gauge remains selectable even if density prevents displaying its badge.
import type { RiverGauge } from './model';

export type HeightBadge = { id: string; x: number; y: number; text: string };
export function heightBadges(gauges: RiverGauge[], project: (lon: number, lat: number) => { x: number; y: number },
  width: number, height: number, selectedId?: string): HeightBadge[] {
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const result: HeightBadge[] = [];
  const ordered = [...gauges].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
  // Reserve a small clear area around gauge centres, so numeric labels don't
  // cover the actual river markers and obscure their trend colours.
  const centres = gauges.map((g) => project(g.lon, g.lat));
  for (const g of ordered) {
    if (!Number.isFinite(Number(g.level))) continue;
    const point = project(g.lon, g.lat);
    const text = `${Number(g.level).toFixed(2)} m`;
    const w = 54, h = 21;
    const candidates = [
      { x: point.x + 13, y: point.y - 27 },
      { x: point.x - w - 13, y: point.y - 27 },
      { x: point.x + 13, y: point.y + 6 },
      { x: point.x - w - 13, y: point.y + 6 },
    ];
    const chosen = candidates.find((box) => box.x >= 3 && box.y >= 3 && box.x + w < width - 3 && box.y + h < height - 3 &&
      occupied.every((other) => !intersects({ ...box, w, h }, other)) &&
      centres.every((centre) => centre === point || !(centre.x > box.x - 9 && centre.x < box.x + w + 9 && centre.y > box.y - 9 && centre.y < box.y + h + 9)));
    if (!chosen) continue;
    occupied.push({ ...chosen, w, h });
    result.push({ id: g.id, ...chosen, text });
  }
  return result;
}
