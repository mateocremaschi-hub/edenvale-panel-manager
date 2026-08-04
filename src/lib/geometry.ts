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

/** Uniform box size for every tracker in the block, from the block's own typical
 * column/row pitch. Deliberately NOT varied per tracker -- an earlier per-tracker "shrink
 * near close neighbours" version produced an inconsistent patchwork of very different sizes
 * within the same block, which looked worse than the rare tight spot touching slightly. If a
 * specific block still has genuine overlap, that's a block-specific tweak, not a general one. */
export function computeTrackerBoxSizes(geometry: BlockGeometry): Map<string, { w: number; h: number }> {
  const trackers = Object.values(geometry.trackers);
  const minDim = Math.min(geometry.w, geometry.h);

  const globalGx = median(clusterGaps(trackers.map((t) => t.cx))) || geometry.w / 20;
  const globalGy = median(clusterGaps(trackers.map((t) => t.cy))) || geometry.h / 20;
  const w = clamp(globalGx * 0.82, minDim / 150, minDim / 6);
  const h = clamp(globalGy * 0.82, minDim / 150, minDim / 6);

  const sizes = new Map<string, { w: number; h: number }>();
  for (const key of Object.keys(geometry.trackers)) sizes.set(key, { w, h });
  return sizes;
}
