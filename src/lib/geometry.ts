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
