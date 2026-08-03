import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/store/settings';
import { newId } from '@/lib/id';

export default function Settings() {
  const operators = useLiveQuery(() => db.operators.toArray(), [], []);
  const { appName, setAppName, adminPin, setAdminPin, voltageMin, voltageMax, setVoltageRange } = useSettings();

  const [name, setName] = useState(appName);
  const [newOperator, setNewOperator] = useState('');
  const [pin, setPin] = useState('');
  const [vMin, setVMin] = useState(String(voltageMin));
  const [vMax, setVMax] = useState(String(voltageMax));

  async function addOperator() {
    const trimmed = newOperator.trim();
    if (!trimmed) return;
    await db.operators.add({ operatorId: newId('op'), name: trimmed, active: true });
    setNewOperator('');
  }

  async function toggleOperator(id: string, active: boolean) {
    await db.operators.update(id, { active: !active });
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      <h1 className="text-lg font-semibold text-slate-100">Settings</h1>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">App name</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={() => setAppName(name)} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Changes the name shown inside the app. The installed PWA icon name comes from the manifest and
          needs a rebuild + redeploy to change.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Operators</h2>
        <div className="flex flex-col gap-2">
          {(operators ?? []).map((op) => (
            <div key={op.operatorId} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className={op.active ? 'text-slate-100' : 'text-slate-500 line-through'}>{op.name}</span>
              <button onClick={() => toggleOperator(op.operatorId, op.active)} className="text-xs text-accent-blue">
                {op.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newOperator}
            onChange={(e) => setNewOperator(e.target.value)}
            placeholder="Full name"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={addOperator} className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel">
            Add
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Admin PIN</h2>
        <p className="mb-2 text-xs text-slate-500">
          Protects import, settings changes and voiding records. Leave blank to disable (Etapa 0 default).
        </p>
        <div className="flex gap-2">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={adminPin ? '••••' : 'No PIN set'}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={() => setAdminPin(pin || null)} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Voltage validation range</h2>
        <div className="flex items-center gap-2">
          <input
            value={vMin}
            onChange={(e) => setVMin(e.target.value)}
            type="number"
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <span className="text-slate-500">to</span>
          <input
            value={vMax}
            onChange={(e) => setVMax(e.target.value)}
            type="number"
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button
            onClick={() => setVoltageRange(Number(vMin), Number(vMax))}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
      </section>

      <footer className="pt-2 text-center text-xs text-slate-600">Developed by Mateo Cremaschi</footer>
    </div>
  );
}
