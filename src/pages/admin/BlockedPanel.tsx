import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import { diffDays, shortDate } from '../../lib/dates';
import type { AdminBlockedDay } from '../../lib/types';

/** 続いている日付で、理由が同じものを1つの期間にまとめる */
function groupRanges(days: AdminBlockedDay[]): AdminBlockedDay[][] {
  const groups: AdminBlockedDay[][] = [];
  for (const d of days) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.reason === d.reason && diffDays(prev.date, d.date) === 1) last.push(d);
    else groups.push([d]);
  }
  return groups;
}

/** 受付しない日（連休・年末年始など）の設定 */
export function BlockedPanel() {
  const { adminSession, run, staffName, data } = useApp();
  const [list, setList] = useState<AdminBlockedDay[] | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (adminSession) api.adminBlockedDays(adminSession).then(setList, () => setList([]));
  };
  useEffect(load, [adminSession, data]);

  if (!adminSession) return null;
  const invalid = !start || !end || end < start;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">受付しない日を追加</h2>
        <p className="muted small">
          連休・年末年始など、希望休・希望有休を受け付けない日を決めます。理由は全員に見えます。
          出勤時間希望・予定ありのコメントは書けます。すでに入っている希望は消さずに残り、下の一覧と「月間一覧」に表示されます。
        </p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (invalid) return;
            setBusy(true);
            const ok = await run(() => api.adminSaveBlockedDays(adminSession, start, end, reason), '受付しない日を登録しました');
            setBusy(false);
            if (ok) {
              setStart('');
              setEnd('');
              setReason('');
              load();
            }
          }}
        >
          <div className="field-pair">
            <label className="field">
              <span>開始日</span>
              <input
                className="input"
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (!end || end < e.target.value) setEnd(e.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>終了日（1日だけなら開始日と同じ）</span>
              <input className="input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>理由（みんなに見えます）</span>
            <input className="input" value={reason} maxLength={50} placeholder="例：年末年始、GW" onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || invalid}>
            登録する
          </button>
        </form>
      </section>

      <section className="card">
        <h3 className="card-title">登録されている受付しない日</h3>
        {list === null && <p className="muted">読み込み中…</p>}
        {list?.length === 0 && <p className="empty">ありません。</p>}
        <ul className="ll-list">
          {list &&
            groupRanges(list).map((g) => {
              const first = g[0];
              const last = g[g.length - 1];
              const reqs = g.flatMap((d) => d.requests.map((r) => ({ ...r, date: d.date })));
              return (
                <li key={first.date} className="ll-item">
                  <div className="ll-main">
                    <span className="blocked-sample" aria-hidden="true" />
                    <strong>
                      {shortDate(first.date)}
                      {g.length > 1 && `〜${shortDate(last.date)}`}
                    </strong>
                    <span>{first.reason || '（理由なし）'}</span>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm push-right"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm('この期間の受付を再開しますか？')) return;
                        setBusy(true);
                        await run(() => api.adminDeleteBlockedDays(adminSession, g.map((d) => d.date)), '受付を再開しました');
                        setBusy(false);
                        load();
                      }}
                    >
                      解除
                    </button>
                  </div>
                  {reqs.length > 0 && (
                    <p className="warn-box small">
                      すでに入っている希望：
                      {reqs
                        .map((r) => `${shortDate(r.date)} ${staffName(r.staff_id)}（${r.kind === 'off' ? '希望休' : '希望有休'}）`)
                        .join('、')}
                      。必要なら本人と相談し、「月間一覧」のマスから取り消してください。
                    </p>
                  )}
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
