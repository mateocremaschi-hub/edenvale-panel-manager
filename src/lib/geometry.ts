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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Per-tracker box size for the schematic view, sized from EACH tracker's own distance to
 * its nearest neighbour (not a single block-wide size). This guarantees no two tracker boxes
 * ever overlap, however irregular the block's layout is (some blocks mix a dense cluster of
 * special trackers with a regular grid elsewhere -- a single global size overlapped there). */
export function computeTrackerBoxSizes(geometry: BlockGeometry): Map<string, { w: number; h: number }> {
  const entries = Object.entries(geometry.trackers);
  const minDim = Math.min(geometry.w, geometry.h);
  const fallback = minDim / 15;
  const maxSize = minDim / 6;
  const sizes = new Map<string, { w: number; h: number }>();

  for (const [key, t] of entries) {
    let nearest = Infinity;
    for (const [key2, t2] of entries) {
      if (key2 === key) continue;
      const d = Math.hypot(t.cx - t2.cx, t.cy - t2.cy);
      if (d > 1 && d < nearest) nearest = d;
    }
    if (!Number.isFinite(nearest)) nearest = fallback;
    // 0.42 of the nearest-neighbour distance on each tracker keeps every pair's combined
    // half-widths under that distance (0.42 + 0.42 = 0.84 < 1), so boxes never touch.
    const size = clamp(nearest * 0.42, minDim / 300, maxSize);
    sizes.set(key, { w: size, h: size });
  }
  return sizes;
}
