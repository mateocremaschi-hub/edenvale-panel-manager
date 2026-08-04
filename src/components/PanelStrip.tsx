import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Panel } from '@/lib/types';

interface Props {
  title?: string;
  panels: Panel[];
}

function panelStatusColor(status: Panel['status']): string {
  switch (status) {
    case 'pending_replacement':
      return 'rgba(217,83,79,0.9)';
    case 'issue_reported':
    case 'under_assessment':
    case 'monitoring':
      return 'rgba(224,138,60,0.9)';
    case 'replaced':
      return 'rgba(92,184,92,0.9)';
    case 'closed':
      return 'rgba(91,114,144,0.45)';
    default:
      return 'rgba(91,114,144,0.85)';
  }
}

/** Norte->Sur schematic strip of a string's 28 panels, tappable one by one. Position order
 * comes straight from the imported Excel (locationId's module number), not from any drawing. */
export default function PanelStrip({ title, panels }: Props) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Panel | null>(panels[0] ?? null);

  useEffect(() => {
    setActive(panels[0] ?? null);
  }, [panels]);

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function replaceThisPanel() {
    if (!active) return;
    navigate(`/replacements?panelId=${encodeURIComponent(active.panelId)}`);
  }

  if (panels.length === 0) {
    return <p className="text-sm text-slate-500">No imported panels found at this location yet.</p>;
  }

  return (
    <div>
      {title && <div className="mb-1 text-xs text-slate-400">{title}</div>}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">N</span>
        <div className="flex flex-1 gap-0.5">
          {panels.map((p) => {
            const pos = p.locationId.split('.').pop();
            const isActive = active?.panelId === p.panelId;
            return (
              <button
                key={p.panelId}
                onClick={() => setActive(p)}
                title={`#${pos} · ${p.serialNumber}`}
                className="h-7 flex-1 rounded-[2px]"
                style={{
                  backgroundColor: panelStatusColor(p.status),
                  outline: isActive ? '2px solid #4A90D9' : '1px solid rgba(255,255,255,0.2)',
                }}
              />
            );
          })}
        </div>
        <span className="text-xs font-semibold text-slate-400">S</span>
      </div>
      {active && (
        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Pos {active.locationId.split('.').pop()}</span>
            <span className="font-mono text-slate-200">{active.serialNumber}</span>
            <span className="text-slate-400">{active.status}</span>
            <button onClick={() => copy(active.serialNumber)} className="text-accent-blue">
              Copy
            </button>
          </div>
          <button
            onClick={replaceThisPanel}
            className="rounded-lg bg-accent-blue px-3 py-2 text-xs font-semibold text-white active:opacity-80"
          >
            🔧 Replace this panel
          </button>
        </div>
      )}
    </div>
  );
}
