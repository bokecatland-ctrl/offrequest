import { useApp } from '../AppContext';
import { shortDate } from '../lib/dates';
import { hasAnything, type DayInfo } from '../lib/monthView';
import { DayEntries } from './DayEntries';

/** リスト表示：希望・予定がある日を日付順に。名前・種類・コメントを省略せずに見せる */
export function DayList({
  days,
  meId,
  onSelect,
}: {
  days: Map<string, DayInfo>;
  meId: string | null;
  onSelect: (date: string) => void;
}) {
  const { data, boot, staffName } = useApp();
  if (!data || !boot) return null;
  const list = [...days.values()].filter(hasAnything);
  const max = boot.settings.max_per_day;

  return (
    <div className="day-list">
      {data.memos.length > 0 && (
        <section className="card">
          <h3 className="card-title">今月全体のメモ</h3>
          <ul className="memo-list">
            {data.memos.map((m) => (
              <li key={m.staff_id}>
                <strong>{staffName(m.staff_id)}</strong>
                <p className="pre-wrap">{m.memo}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.long_leaves.length > 0 && (
        <section className="card">
          <h3 className="card-title">長期有休</h3>
          <ul className="memo-list">
            {data.long_leaves.map((l) => (
              <li key={l.id}>
                <strong>{staffName(l.staff_id)}</strong>{' '}
                <span>
                  {shortDate(l.start_date)}〜{shortDate(l.end_date)}
                </span>
                {l.memo && <p className="pre-wrap">{l.memo}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 && <p className="empty card">まだ希望・予定はありません。</p>}

      {list.map((day) => (
        <div
          key={day.date}
          className="card day-card"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(day.date)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(day.date);
            }
          }}
        >
          <div className="day-card-head">
            <strong>{shortDate(day.date)}</strong>
            <span className={`day-count${day.offs.length >= max ? ' full' : ''}`}>
              希望休 {day.offs.length}/{max}
              {day.offs.length >= max ? '・満員' : ''}
            </span>
          </div>
          <DayEntries day={{ ...day, longs: [] }} meId={meId} />
        </div>
      ))}
    </div>
  );
}
