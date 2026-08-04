import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';

interface ZoomPanProps {
  children: ReactNode;
  aspectRatio: number; // width / height
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;

export default function ZoomPan({ children, aspectRatio }: ZoomPanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  function clamp(nextScale: number, x: number, y: number, rect: DOMRect) {
    const maxX = (rect.width * (nextScale - 1)) / 2 + rect.width * 0.15;
    const maxY = (rect.height * (nextScale - 1)) / 2 + rect.height * 0.15;
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  }

  function onWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 - e.deltaY * 0.0015)));
    setScale(next);
    setPos((p) => clamp(next, p.x, p.y, rect));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      dragStart.current = null;
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = containerRef.current!.getBoundingClientRect();

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStart.current.scale * (dist / pinchStart.current.dist)));
      setScale(next);
      setPos((p) => clamp(next, p.x, p.y, rect));
      return;
    }
    if (dragStart.current && pointers.current.size === 1 && scale > 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos(clamp(scale, dragStart.current.posX + dx, dragStart.current.posY + dy, rect));
    }
  }

  function endPointer(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  }

  function step(dir: 1 | -1) {
    const rect = containerRef.current!.getBoundingClientRect();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + dir * 0.7));
    setScale(next);
    setPos((p) => clamp(next, p.x, p.y, rect));
  }

  function reset() {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        className="relative w-full touch-none overflow-hidden rounded-lg border border-border bg-white"
        style={{ aspectRatio: String(aspectRatio) }}
      >
        <div
          className="absolute inset-0 origin-center"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
        >
          {children}
        </div>
      </div>
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          onClick={() => step(1)}
          className="h-9 w-9 rounded-lg border border-border bg-bg-panel/90 text-lg font-bold text-slate-100 active:bg-bg-raised"
        >
          +
        </button>
        <button
          onClick={() => step(-1)}
          className="h-9 w-9 rounded-lg border border-border bg-bg-panel/90 text-lg font-bold text-slate-100 active:bg-bg-raised"
        >
          −
        </button>
        <button
          onClick={reset}
          className="h-9 rounded-lg border border-border bg-bg-panel/90 px-3 text-xs font-medium text-slate-100 active:bg-bg-raised"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
