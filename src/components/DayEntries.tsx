import { useApp } from '../AppContext';
import { shortDate } from '../lib/dates';
import type { DayInfo } from '../lib/monthView';
import { NOTE_LABEL, type OffRequest } from '../lib/types';

export function KindBadge({ r }: { r: OffRequest }) {
  if (r.kind === 'off') return <span className="badge badge-off">希望休</span>;
  return r.status === 'confirmed' ? (
    <span className="badge badge-paid">希望有休・確認済み</span>
  ) : (
    <span className="badge badge-paid-pending">希望有休・要相談</span>
  );
}

interface PersonRow {
  staffId: string;
  reqs: OffRequest[];
  long: { start: string; end: string; memo: string } | null;
  notes: DayInfo['notes'];
}

/** その日に入っている人ごとに、名前・種類・コメントをまとめる */
export function groupByPerson(day: DayInfo): PersonRow[] {
  const order: string[] = [];
  const map = new Map<string, PersonRow>();
  const get = (id: string) => {
    let row = map.get(id);
    if (!row) {
      row = { staffId: id, reqs: [], long: null, notes: [] };
      map.set(id, row);
      order.push(id);
    }
    return row;
  };
  day.offs.forEach((r) => get(r.staff_id).reqs.push(r));
  day.paids.forEach((r) => get(r.staff_id).reqs.push(r));
  day.longs.forEach((l) => {
    get(l.staff_id).long = { start: l.start_date, end: l.end_date, memo: l.memo };
  });
  day.notes.forEach((n) => get(n.staff_id).notes.push(n));
  return order.map((id) => map.get(id)!);
}

/** その日の全員の「名前・種類・コメント」（省略せずに表示） */
export function DayEntries({ day, meId }: { day: DayInfo; meId: string | null }) {
  const { staffName } = useApp();
  const rows = groupByPerson(day);
  if (rows.length === 0) return <p className="empty">まだ誰も入れていません。</p>;
  return (
    <ul className="entries">
      {rows.map((p) => (
        <li key={p.staffId} className={`entry${p.staffId === meId ? ' entry-me' : ''}`}>
          <div className="entry-head">
            <strong className="entry-name">{staffName(p.staffId)}</strong>
            {p.staffId === meId && <span className="me-tag">自分</span>}
            {p.reqs.map((r) => (
              <KindBadge key={r.id} r={r} />
            ))}
            {p.long && <span className="badge badge-long">長期有休</span>}
          </div>
          {p.long && (
            <p className="entry-line">
              <span className="entry-sub">
                {shortDate(p.long.start)}〜{shortDate(p.long.end)}
              </span>
              {p.long.memo && <span> {p.long.memo}</span>}
            </p>
          )}
          {p.notes.map((n) => (
            <p key={n.id} className="entry-line">
              <span className={`badge badge-note-${n.type}`}>{NOTE_LABEL[n.type]}</span>
              <span className="entry-comment">{n.comment}</span>
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
