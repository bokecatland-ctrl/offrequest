import { dayOfWeek, parts, todayTokyo, WEEKDAYS } from '../lib/dates';
import type { DayInfo } from '../lib/monthView';

interface Props {
  days: Map<string, DayInfo>;
  maxPerDay: number;
  meId: string | null;
  onSelect: (date: string) => void;
}

/**
 * 月カレンダー。マスには日付・埋まり具合（丸）・小さな印だけを出す。
 * 名前や文章は日付の詳細とリストで見せる。
 */
export function Calendar({ days, maxPerDay, meId, onSelect }: Props) {
  const list = [...days.values()];
  if (list.length === 0) return null;
  const lead = dayOfWeek(list[0].date);
  const today = todayTokyo();

  return (
    <div className="calendar" role="grid" aria-label="カレンダー">
      <div className="cal-row cal-head" role="row">
        {WEEKDAYS.map((w, i) => (
          <span key={w} role="columnheader" className={`cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
            {w}
          </span>
        ))}
      </div>
      <div className="cal-grid" role="rowgroup">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className="cal-blank" aria-hidden="true" />
        ))}
        {list.map((day) => {
          const dow = dayOfWeek(day.date);
          const n = day.offs.length;
          const full = n >= maxPerDay;
          const mineOff = !!meId && day.offs.some((r) => r.staff_id === meId);
          const minePaid = !!meId && day.paids.some((r) => r.staff_id === meId);
          // 自分の丸を先頭にして、色と形（枠つき）で目立たせる
          const offs = [...day.offs].sort((a, b) => Number(b.staff_id === meId) - Number(a.staff_id === meId));
          const label = [
            `${parts(day.date).d}日`,
            `希望休${n}/${maxPerDay}人${full ? '・満員' : ''}`,
            mineOff ? 'あなたの希望休' : '',
            minePaid ? 'あなたの希望有休' : '',
            day.paids.length ? `希望有休${day.paids.length}人` : '',
            day.notes.length ? '出勤時間希望・予定あり' : '',
            day.longs.length ? '長期有休あり' : '',
          ]
            .filter(Boolean)
            .join('、');
          return (
            <button
              type="button"
              key={day.date}
              className={[
                'cal-cell',
                full ? 'full' : '',
                mineOff || minePaid ? 'mine' : '',
                day.date === today ? 'today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(day.date)}
              aria-label={label}
            >
              <span className={`cal-num${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`}>{parts(day.date).d}</span>
              <span className="cal-dots" aria-hidden="true">
                {Array.from({ length: maxPerDay }, (_, i) => {
                  const r = offs[i];
                  return <span key={i} className={`dot${r ? ' filled' : ''}${r && r.staff_id === meId ? ' me' : ''}`} />;
                })}
              </span>
              <span className="cal-marks" aria-hidden="true">
                {day.paids.length > 0 && <span className="mk mk-paid" />}
                {day.notes.length > 0 && <span className="mk mk-note" />}
              </span>
              {day.longs.length > 0 && <span className="cal-long" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Legend({ maxPerDay }: { maxPerDay: number }) {
  return (
    <div className="legend">
      <ul>
        <li>
          <span className="dot filled" />
          <span className="dot" /> 希望休（1日{maxPerDay}人まで）
        </li>
        <li>
          <span className="mk mk-paid" /> 希望有休
        </li>
        <li>
          <span className="mk mk-note" /> 出勤時間希望・予定あり
        </li>
        <li>
          <span className="mk mk-long-band" /> 長期有休
        </li>
        <li>
          <span className="dot filled me" /> 自分
        </li>
      </ul>
      <p>日付をタップすると、誰が入れているかを確認して登録できます。</p>
    </div>
  );
}
