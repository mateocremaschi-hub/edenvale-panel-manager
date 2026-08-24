import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { newId } from '@/lib/id';
import { t } from '@/i18n';

export default function OperatorGate({ children }: { children: ReactNode }) {
  const { operatorId, setOperator } = useSession();
  const allOperators = useLiveQuery(() => db.operators.toArray(), [], []);
  const activeOperators = (allOperators ?? []).filter((o) => o.active);
  const [newName, setNewName] = useState('');

  if (operatorId) return <>{children}</>;

  async function addOperator() {
    const name = newName.trim();
    if (!name) return;
    const id = newId('op');
    await db.operators.add({ operatorId: id, name, active: true });
    setOperator(id, name);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{t('operator_pick_title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('operator_pick_subtitle')}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {activeOperators.map((op) => (
          <button
            key={op.operatorId}
            onClick={() => setOperator(op.operatorId, op.name)}
            className="rounded-xl border border-border bg-bg-panel px-4 py-3 text-left text-base font-medium text-slate-100 active:bg-bg-raised"
          >
            {op.name}
          </button>
        ))}
      </div>
      <div className="flex w-full max-w-sm gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('operator_name_placeholder')}
          className="flex-1 rounded-xl border border-border bg-bg-panel px-4 py-3 text-base text-slate-100 placeholder:text-slate-500"
        />
        <button
          onClick={addOperator}
          className="rounded-xl btn-primary px-4 py-3 text-base font-semibold text-white active:opacity-80"
        >
          {t('operator_add_new')}
        </button>
      </div>
    </div>
  );
}
