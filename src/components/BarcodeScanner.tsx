import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface Props {
  title?: string;
  onResult: (text: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ title, onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserMultiFormatReader();

    async function start() {
      try {
        // Prefer the rear camera, fall back to whatever default camera the browser picks.
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result) => {
            if (result && !stopped) {
              stopped = true;
              onResult(result.getText());
            }
          }
        );
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    }
    start();

    return () => {
      stopped = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-3">
        <span className="text-sm font-medium text-white">{title ?? 'Scan barcode'}</span>
        <button onClick={onClose} className="text-sm text-accent-blue">
          Cancel
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-x-8 top-1/3 h-24 rounded-lg border-2 border-accent-blue/80" />
      </div>
      {error && (
        <p className="px-3 pt-2 text-xs text-status-pending">
          Camera unavailable ({error}). Type the code below instead.
        </p>
      )}
      <div className="flex gap-2 p-3">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type the serial / code manually"
          className="flex-1 rounded-lg border border-border bg-bg-panel px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <button
          onClick={() => manual.trim() && onResult(manual.trim())}
          disabled={!manual.trim()}
          className="rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Use
        </button>
      </div>
    </div>
  );
}
