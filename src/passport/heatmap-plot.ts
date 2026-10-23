import type { HeatPoint } from "../qloo/analysis.ts";
export interface PlottedHeatPoint extends HeatPoint {
  x: number;
  y: number;
  /** Only relative marker intensity inside THIS Qloo response; not a probability. */
  intensity: number;
}
export interface HeatmapPlot {
  points: PlottedHeatPoint[];
  bounds: { north: number; south: number; east: number; west: number };
}
/** Render real Qloo coordinates on an explicitly schematic city coordinate plot.
 * No fake basemap, neighborhood names, or calculated individual audience scores.
 */
export function plotHeatmap(input: readonly HeatPoint[]): HeatmapPlot | undefined {
  const distinct = new Map<string, HeatPoint>();
  for (const point of input.slice(0, 2000)) {
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
        !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
        !Number.isFinite(point.affinity)) continue;
    const id = point.latitude.toFixed(5) + ":" + point.longitude.toFixed(5);
    const old = distinct.get(id);
    if (!old || point.affinity > old.affinity) distinct.set(id, point);
  }
  const unique = [...distinct.values()].slice(0, 300);
  if (!unique.length) return;
  const vals=unique.map(p => p.affinity);
  const min=Math.min(...vals), max=Math.max(...vals);
  const south=Math.min(...unique.map(p=>p.latitude)),north=Math.max(...unique.map(p=>p.latitude));
  const west=Math.min(...unique.map(p=>p.longitude)),east=Math.max(...unique.map(p=>p.longitude));
  const latSpan=Math.max(north-south,0.01),lonSpan=Math.max(east-west,0.01);
  const points=unique.map(p=>({
    ...p,
    x: 50 + 88*(p.longitude-(east+west)/2)/lonSpan,
    y: 50 - 88*(p.latitude-(north+south)/2)/latSpan,
    intensity: min === max ? 0.5 : (p.affinity-min)/(max-min)
  })).sort((a,b)=>a.intensity-b.intensity);
  return {points,bounds:{north,south,east,west}};
}
