import { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Calendar, Legend } from '../components/Calendar';
import { DayList } from '../components/DayList';
import { DaySheet } from '../components/DaySheet';
import { StatusCard } from '../components/StatusCard';
import { buildDays } from '../lib/monthView';
import { KEYS, load, save } from '../lib/storage';

export function CalendarPage() {
  const { data, boot, staffId, adminSession } = useApp();
  const [view, setView] = useState<'calendar' | 'list'>(() => (load(KEYS.view) === 'list' ? 'list' : 'calendar'));
  const [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => (data ? buildDays(data) : new Map()), [data]);

  if (!boot) return null;
  if (!data) return <p className="empty card">読み込み中…</p>;

  const me = adminSession ? null : staffId;
  const changeView = (v: 'calendar' | 'list') => {
    setView(v);
    save(KEYS.view, v);
  };

  return (
    <>
      <StatusCard />
      <div className="segmented" role="tablist" aria-label="表示の切り替え">
        {(['calendar', 'list'] as const).map((v) => (
          <button
            type="button"
            key={v}
            role="tab"
            aria-selected={view === v}
            className={view === v ? 'active' : ''}
            onClick={() => changeView(v)}
          >
            {v === 'calendar' ? 'カレンダー' : 'リスト'}
          </button>
        ))}
      </div>
      {view === 'calendar' ? (
        <section className="card">
          <Calendar days={days} maxPerDay={boot.settings.max_per_day} meId={me} onSelect={setSelected} />
          <Legend maxPerDay={boot.settings.max_per_day} />
        </section>
      ) : (
        <DayList days={days} meId={me} onSelect={setSelected} />
      )}
      <DaySheet day={selected ? days.get(selected) ?? null : null} onClose={() => setSelected(null)} />
    </>
  );
}
