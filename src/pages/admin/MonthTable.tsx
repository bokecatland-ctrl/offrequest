import { dayOfWeek, monthDates, parts, WEEKDAYS } from '../../lib/dates';
import type { DayInfo } from '../../lib/monthView';
import type { AdminStaff, MonthData } from '../../lib/types';

interface Props {
  data: MonthData;
  staff: AdminStaff[];
  days: Map<string, DayInfo>;
  maxDays: number;
  maxPerDay: number;
  onCell: (staffId: string, date: string) => void;
}

/** 全員分の月間一覧（スタッフ行 × 日付列。シフト表と同じ向き） */
export function MonthTable({ data, staff, days, maxDays, maxPerDay, onCell }: Props) {
  const dates = monthDates(data.month);
  return (
    <div className="table-wrap">
      <table className="month-table">
        <thead>
          <tr>
            <th className="sticky-col">名前</th>
            {dates.map((d) => {
              const w = dayOfWeek(d);
              return (
                <th key={d} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>
                  <span className="th-day">{parts(d).d}</span>
                  <span className="th-dow">{WEEKDAYS[w]}</span>
                </th>
              );
            })}
            <th>希望休</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => {
            const offCount = data.requests.filter((r) => r.staff_id === s.id && r.kind === 'off').length;
            return (
              <tr key={s.id} className={s.active ? '' : 'inactive'}>
                <th className="sticky-col name-cell" title={s.name}>
                  <span className="truncate">{s.name}</span>
                </th>
                {dates.map((d) => {
                  const day = days.get(d)!;
                  const req = [...day.offs, ...day.paids].find((r) => r.staff_id === s.id);
                  const long = day.longs.some((l) => l.staff_id === s.id);
                  const notes = day.notes.filter((n) => n.staff_id === s.id);
                  let text = '';
                  let cls = '';
                  if (req?.kind === 'off') {
                    text = '休';
                    cls = 'c-off';
                  } else if (req?.kind === 'paid') {
                    text = req.status === 'confirmed' ? '有' : '有?';
                    cls = req.status === 'confirmed' ? 'c-paid' : 'c-pending';
                  } else if (long) {
                    text = '長';
                    cls = 'c-long';
                  }
                  const title = [
                    req?.kind === 'off' ? '希望休' : '',
                    req?.kind === 'paid' ? `希望有休（${req.status === 'confirmed' ? '確認済み' : '要相談'}）` : '',
                    long ? '長期有休' : '',
                    req?.is_exception ? '例外登録' : '',
                    ...notes.map((n) => `${n.type === 'shift' ? '出勤時間希望' : '予定あり'}：${n.comment}`),
                  ]
                    .filter(Boolean)
                    .join('\n');
                  return (
                    <td key={d} className={`${cls}${day.offs.length >= maxPerDay ? ' day-full' : ''}`}>
                      <button
                        type="button"
                        className="cell-btn"
                        title={title || undefined}
                        aria-label={`${s.name} ${parts(d).d}日 ${title.replace(/\n/g, '、') || '空き'}`}
                        onClick={() => onCell(s.id, d)}
                      >
                        {text}
                        {req?.is_exception && <span className="c-exc">!</span>}
                        {notes.length > 0 && <span className="c-note">◆</span>}
                      </button>
                    </td>
                  );
                })}
                <td className={`count-cell${offCount > maxDays ? ' over' : ''}`}>
                  {offCount}/{maxDays}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky-col">希望休の人数</th>
            {dates.map((d) => {
              const n = days.get(d)!.offs.length;
              return (
                <td key={d} className={n >= maxPerDay ? 'foot-full' : ''}>
                  {n || ''}
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
