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
 * within the same block, which looked worse than the rare tight spot touching slightly.
 *
 * EXCEPTION: a handful of blocks (confirmed: 5, 15, 16, 17, 24, 27) have a genuinely
 * scattered/fan layout on one axis rather than clean columns -- almost every tracker sits at
 * its own near-unique position, so "typical gap between columns" isn't a meaningful number
 * (it measures the tiny spacing between individually-adjacent trackers, not a real column
 * pitch) and comes out far too small, rendering huge empty-looking gaps where whole rows of
 * trackers are actually just squeezed down to near-invisible size. Detected automatically
 * (not hardcoded by block number, so it self-corrects for any block, present or future):
 * if most trackers don't share a position with any other on an axis, that axis falls back to
 * each tracker's own nearest-neighbour distance along that axis specifically, instead of the
 * block-wide median. */
export function computeTrackerBoxSizes(geometry: BlockGeometry): Map<string, { w: number; h: number }> {
  const entries = Object.entries(geometry.trackers);
  const trackers = entries.map(([, t]) => t);
  const minDim = Math.min(geometry.w, geometry.h);

  const cxVals = trackers.map((t) => t.cx);
  const cyVals = trackers.map((t) => t.cy);
  const gxGaps = clusterGaps(cxVals);
  const gyGaps = clusterGaps(cyVals);
  const globalGx = median(gxGaps) || geometry.w / 20;
  const globalGy = median(gyGaps) || geometry.h / 20;
  const globalW = clamp(globalGx * 0.82, minDim / 150, minDim / 6);
  const globalH = clamp(globalGy * 0.82, minDim / 150, minDim / 6);

  // "Scattered" axis: two independent signals, either one is enough. (1) almost as many
  // distinct clusters as trackers -- no real columns/rows to measure a pitch from. (2) the
  // gap distribution is bimodal -- mostly tiny within-row gaps plus a few real between-row
  // gaps -- which (1) alone can miss: block 17 has 51 clusters for 92 trackers (55%, just
  // under the 60% cutoff) yet its median gap (14.8) is 19x smaller than its 90th-percentile
  // gap (276), so the median still lands on the wrong (within-row) population. Confirmed
  // against all 36 blocks: this combined check flags exactly the known-bad ones (5, 15, 16,
  // 17, 24, 27) and nothing else.
  function isScattered(gaps: number[], trackerCount: number): boolean {
    if (gaps.length + 1 > trackerCount * 0.6) return true;
    if (gaps.length < 5) return false;
    const sorted = [...gaps].sort((a, b) => a - b);
    const med = median(sorted);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    return med > 0 && p90 / med > 4;
  }
  const xScattered = isScattered(gxGaps, trackers.length);
  const yScattered = isScattered(gyGaps, trackers.length);

  let rowGroupW: number | null = null;
  let rowGroupH: number | null = null;
  if (xScattered || yScattered) {
    const groups = new Map<string, { sumX: number; sumY: number; n: number }>();
    for (const t of trackers) {
      const gk = `${t.side}-${t.pos ?? 0}`;
      const g = groups.get(gk) ?? { sumX: 0, sumY: 0, n: 0 };
      g.sumX += t.cx;
      g.sumY += t.cy;
      g.n++;
      groups.set(gk, g);
    }
    if (groups.size >= 2) {
      const centersX = [...groups.values()].map((g) => g.sumX / g.n).sort((a, b) => a - b);
      const centersY = [...groups.values()].map((g) => g.sumY / g.n).sort((a, b) => a - b);
      const gapsX = centersX.slice(1).map((v, i) => v - centersX[i]);
      const gapsY = centersY.slice(1).map((v, i) => v - centersY[i]);
      if (gapsX.length > 0) rowGroupW = clamp(median(gapsX) * 0.7, minDim / 150, minDim / 5);
      if (gapsY.length > 0) rowGroupH = clamp(median(gapsY) * 0.7, minDim / 150, minDim / 5);
    }
  }

  const sizes = new Map<string, { w: number; h: number }>();
  for (const [key, t] of entries) {
    let w = globalW;
    let h = globalH;
    if (xScattered && rowGroupW != null) {
      w = rowGroupW;
    } else if (xScattered) {
      let nearestDx = Infinity;
      for (const t2 of trackers) {
        if (t2 === t) continue;
        const dx = Math.abs(t.cx - t2.cx);
        if (dx > 1 && dx < nearestDx) nearestDx = dx;
      }
      if (Number.isFinite(nearestDx)) w = clamp(nearestDx * 0.7, minDim / 150, minDim / 6);
    }
    if (yScattered && rowGroupH != null) {
      h = rowGroupH;
    } else if (yScattered) {
      let nearestDy = Infinity;
      for (const t2 of trackers) {
        if (t2 === t) continue;
        const dy = Math.abs(t.cy - t2.cy);
        if (dy > 1 && dy < nearestDy) nearestDy = dy;
      }
      if (Number.isFinite(nearestDy)) h = clamp(nearestDy * 0.7, minDim / 150, minDim / 6);
    }
    sizes.set(key, { w, h });
  }
  return sizes;
}
