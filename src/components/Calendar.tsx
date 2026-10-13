import { useApp } from '../AppContext';
import { dayOfWeek, parts, todayTokyo, WEEKDAYS } from '../lib/dates';
import type { DayInfo } from '../lib/monthView';
import { groupByPerson } from './DayEntries';
import { useMedia, WIDE_CALENDAR } from './useMedia';

/** PC 表示で、1つのマスに名前を出す最大人数（それ以上は「ほかn件」） */
const MAX_NAMES = 4;

interface Props {
  days: Map<string, DayInfo>;
  maxPerDay: number;
  meId: string | null;
  onSelect: (date: string) => void;
}

/**
 * 月カレンダー。
 *   スマホ：マスには日付・埋まり具合（丸）・小さな印だけを出す。名前や文章は日付の詳細とリストで見せる。
 *   PC（広い画面）：マスに名前も出す（長期有休はマス下端の帯に名前）。コメントの文章は詳細で見せる。
 */
export function Calendar({ days, maxPerDay, meId, onSelect }: Props) {
  const named = useMedia(WIDE_CALENDAR);
  const { staffName } = useApp();
  const list = [...days.values()];
  if (list.length === 0) return null;
  const lead = dayOfWeek(list[0].date);
  const today = todayTokyo();

  return (
    <div className={`calendar${named ? ' named' : ''}`} role="grid" aria-label="カレンダー">
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
              {named ? (
                <NamedCell day={day} dow={dow} maxPerDay={maxPerDay} meId={meId} staffName={staffName} />
              ) : (
                <>
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
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** PC 表示のマス：日付・人数・名前（種類ごとに色と形を変える） */
function NamedCell({
  day,
  dow,
  maxPerDay,
  meId,
  staffName,
}: {
  day: DayInfo;
  dow: number;
  maxPerDay: number;
  meId: string | null;
  staffName: (id: string) => string;
}) {
  const n = day.offs.length;
  // 長期有休だけの人は下端の帯に出すので、名前の欄からは外す
  const people = groupByPerson(day)
    .filter((p) => p.reqs.length > 0 || p.notes.length > 0)
    .map((p) => {
      const off = p.reqs.find((r) => r.kind === 'off');
      const paid = p.reqs.find((r) => r.kind === 'paid');
      const kind = off ? 'off' : paid ? (paid.status === 'confirmed' ? 'paid' : 'paid-pending') : 'note';
      return { id: p.staffId, kind, hasNote: p.notes.length > 0 };
    })
    .sort((a, b) => ['off', 'paid', 'paid-pending', 'note'].indexOf(a.kind) - ['off', 'paid', 'paid-pending', 'note'].indexOf(b.kind));
  const shown = people.slice(0, people.length > MAX_NAMES ? MAX_NAMES - 1 : MAX_NAMES);
  const longNames = [...new Set(day.longs.map((l) => staffName(l.staff_id)))].join('・');

  return (
    <>
      <span className="cal-top" aria-hidden="true">
        <span className={`cal-num${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`}>{parts(day.date).d}</span>
        {n > 0 && (
          <span className={`cal-count${n >= maxPerDay ? ' full' : ''}`}>
            {n >= maxPerDay ? '満員' : `${n}/${maxPerDay}`}
          </span>
        )}
      </span>
      <span className="cal-names" aria-hidden="true">
        {shown.map((p) => (
          <span key={p.id} className={`nm nm-${p.kind}${p.id === meId ? ' me' : ''}`}>
            {p.kind === 'note' && <span className="nm-mark">◆</span>}
            <span className="truncate">{staffName(p.id)}</span>
            {p.hasNote && p.kind !== 'note' && <span className="nm-mark">◆</span>}
          </span>
        ))}
        {shown.length < people.length && <span className="nm-more">ほか{people.length - shown.length}人</span>}
      </span>
      {longNames && (
        <span className="cal-long-named" aria-hidden="true">
          <span className="truncate">{longNames}</span>
        </span>
      )}
    </>
  );
}

export function Legend({ maxPerDay }: { maxPerDay: number }) {
  const named = useMedia(WIDE_CALENDAR);
  if (named) {
    return (
      <div className="legend">
        <ul>
          <li>
            <span className="nm nm-off">名前</span> 希望休（1日{maxPerDay}人まで）
          </li>
          <li>
            <span className="nm nm-paid">名前</span> 希望有休（確認済み）
          </li>
          <li>
            <span className="nm nm-paid-pending">名前</span> 希望有休（要相談）
          </li>
          <li>
            <span className="nm-mark">◆</span> 出勤時間希望・予定あり
          </li>
          <li>
            <span className="mk mk-long-band" /> 長期有休
          </li>
          <li>
            <span className="nm nm-off me">名前</span> 自分
          </li>
        </ul>
        <p>日付を押すと、コメントを含めた詳しい内容を確認して登録できます。</p>
      </div>
    );
  }
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
