import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Panel } from '@/lib/types';
import { displaySerial } from '@/lib/panelDisplay';

interface Props {
  title?: string;
  panels: Panel[];
  /** Label for the left end of the strip. Defaults to "1" (legacy: raw ascending order) --
   * BlockView passes a physical-direction label ("Near DC box") instead, since which module
   * number sits at which end varies per string (see dronePicas.ts's piercing-connector note). */
  nearEndLabel?: string;
  farEndLabel?: string;
}

function panelStatusColor(status: Panel['status']): string {
  switch (status) {
    case 'pending_replacement':
    case 'vacant':
      return 'rgba(217,83,79,0.9)';
    case 'issue_reported':
    case 'under_assessment':
    case 'monitoring':
      return 'rgba(224,138,60,0.9)';
    case 'closed':
      return 'rgba(91,114,144,0.45)';
    default:
      // 'replaced' included here on purpose -- a replaced panel is back to normal, no
      // color needed to call attention to it.
      return 'rgba(91,114,144,0.85)';
  }
}

/** Strip of a string's 28 panels, tappable one by one. By default, position order comes
 * straight from the imported Excel (locationId's module number) with ends labelled "1"/"28" --
 * but when the caller knows the real physical layout (BlockView does, via the piercing-
 * connector rule in dronePicas.ts), it passes panels pre-ordered to walk DC-box-near ->
 * DC-box-far left to right, with matching nearEndLabel/farEndLabel, so the strip always reads
 * left-to-right the same way a technician actually walks the row. */
export default function PanelStrip({ title, panels, nearEndLabel = '1', farEndLabel = '28' }: Props) {
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
        <span className="whitespace-nowrap text-xs font-semibold text-slate-400">{nearEndLabel}</span>
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
        <span className="whitespace-nowrap text-xs font-semibold text-slate-400">{farEndLabel}</span>
      </div>
      {active && (
        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Pos {active.locationId.split('.').pop()}</span>
            <span className="font-mono text-slate-200">{displaySerial(active.serialNumber)}</span>
            <span className="text-slate-400">{active.status}</span>
            <button onClick={() => copy(active.serialNumber)} className="text-accent-blue">
              Copy
            </button>
          </div>
          <button
            onClick={replaceThisPanel}
            className="rounded-lg btn-primary px-3 py-2 text-xs font-semibold text-white active:opacity-80"
          >
            {active.serialNumber.startsWith('VACANT-') ? '➕ Install panel here' : '🔧 Replace this panel'}
          </button>
        </div>
      )}
    </div>
  );
}
