export interface GeometryTracker {
  rows: string[]; // e.g. ["R4","R5"]
  cx: number;
  cy: number;
  dcbox: string | null;
  side: 'North' | 'South';
  pos?: number;
  pos_total?: number;
}

export interface GeometryDcBox {
  name: string;
  x: number;
  y: number;
}

export interface GeometryString {
  n: string; // string code, e.g. "S-1.1.23.2.7"
  x: number; // center x, in image pixels
  y: number; // center y, in image pixels
  w: number; // bounding box width, in image pixels
  h: number; // bounding box height, in image pixels
  s: 'North' | 'South';
  t?: string; // tracker number, e.g. "087"
  r?: string; // row, e.g. "R4"
}

export interface BlockGeometry {
  block: number;
  w: number; // image width in pixels
  h: number; // image height in pixels
  road: number;
  axis: 'x' | 'y';
  trackers: Record<string, GeometryTracker>;
  dcbox: GeometryDcBox[];
  strings: GeometryString[];
}

export interface GeometryIndexEntry {
  block: number;
  trackers: number;
  strings: number;
  dcbox: number;
}

const cache = new Map<number, Promise<BlockGeometry>>();
let indexCache: Promise<GeometryIndexEntry[]> | null = null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Which blocks have real plan geometry available (from public/geometry/index.json). */
export function loadGeometryIndex(): Promise<GeometryIndexEntry[]> {
  if (!indexCache) {
    indexCache = fetch('/geometry/index.json').then((r) => {
      if (!r.ok) throw new Error(`Geometry index not found (${r.status})`);
      return r.json();
    });
  }
  return indexCache;
}

export function loadBlockGeometry(block: number): Promise<BlockGeometry> {
  if (!cache.has(block)) {
    cache.set(
      block,
      fetch(`/geometry/${pad2(block)}.json`).then((r) => {
        if (!r.ok) throw new Error(`Geometry for block ${block} not found (${r.status})`);
        return r.json();
      })
    );
  }
  return cache.get(block)!;
}

export function blockImageUrl(block: number): string {
  return `/geometry/images/${pad2(block)}.png`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Gaps between DISTINCT clusters of values (trackers sharing a column/row have near-identical
 * cx/cy; naively diffing every sorted point would mix those near-zero gaps in with the real
 * inter-column/row pitch and badly skew the median). */
function clusterGaps(vals: number[], tolerance = 10): number[] {
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last[last.length - 1] < tolerance) last.push(v);
    else clusters.push([v]);
  }
  const centers = clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  return gaps;
}

/** Per-tracker box size for the schematic view: starts from a "typical" size for the whole
 * block (the median column/row pitch, so most trackers render nice and big -- filling the
 * space instead of leaving it mostly empty), then shrinks JUST the trackers that are locally
 * tighter than that on a given axis, so nothing overlaps. Axes are handled independently
 * (only "same row" neighbours count for width, only "same column" neighbours for height) so
 * a block with wide columns but tight rows doesn't get squeezed on both axes at once. */
export function computeTrackerBoxSizes(geometry: BlockGeometry): Map<string, { w: number; h: number }> {
  const entries = Object.entries(geometry.trackers);
  const trackers = entries.map(([, t]) => t);
  const minDim = Math.min(geometry.w, geometry.h);

  const globalGx = median(clusterGaps(trackers.map((t) => t.cx))) || geometry.w / 20;
  const globalGy = median(clusterGaps(trackers.map((t) => t.cy))) || geometry.h / 20;
  const globalW = clamp(globalGx * 0.82, minDim / 150, minDim / 6);
  const globalH = clamp(globalGy * 0.82, minDim / 150, minDim / 6);
  const rowTolerance = Math.max(globalGy * 0.6, 5); // "same row" band, scaled to this block's own row pitch
  const colTolerance = Math.max(globalGx * 0.6, 5); // "same column" band, scaled to this block's own column pitch

  const sizes = new Map<string, { w: number; h: number }>();
  for (const [key, t] of entries) {
    let nearestX = Infinity;
    let nearestY = Infinity;
    for (const t2 of trackers) {
      if (t2 === t) continue;
      const dx = Math.abs(t.cx - t2.cx);
      const dy = Math.abs(t.cy - t2.cy);
      if (dy < rowTolerance && dx > 1 && dx < nearestX) nearestX = dx;
      if (dx < colTolerance && dy > 1 && dy < nearestY) nearestY = dy;
    }
    const w = Number.isFinite(nearestX) ? clamp(Math.min(globalW, nearestX * 0.42), minDim / 300, minDim / 6) : globalW;
    const h = Number.isFinite(nearestY) ? clamp(Math.min(globalH, nearestY * 0.42), minDim / 300, minDim / 6) : globalH;
    sizes.set(key, { w, h });
  }
  return sizes;
}
