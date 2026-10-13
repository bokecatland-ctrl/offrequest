import { useState } from 'react';
import { useApp } from '../AppContext';
import { LongLeaveForm } from '../components/LongLeaveForm';
import { api } from '../lib/api';
import { shortDate, todayTokyo } from '../lib/dates';
import type { LongLeave } from '../lib/types';

export function LongLeavePage() {
  const { longLeaves, staffId, adminSession, token, run, staffName } = useApp();
  const [editing, setEditing] = useState<LongLeave | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = adminSession ? null : staffId;
  const today = todayTokyo();

  const submit = async (id: string | null, v: { start: string; end: string; memo: string }) => {
    if (!me) return;
    setBusy(true);
    const ok = await run(() => api.saveLongLeave(token, me, id, v.start, v.end, v.memo), '長期有休を保存しました');
    setBusy(false);
    if (ok) {
      setEditing(null);
      setAdding(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2 className="card-title">長期有休</h2>
        <p className="muted">
          希望休とは別枠です（日数・人数の制限なし）。全員に見え、カレンダーにも表示されます。
          長期有休が入っている月の希望休は、管理者に相談してください。
        </p>
        {adminSession && <p className="info-box">管理者モードでは閲覧のみです。代行登録は「管理」から行います。</p>}
        {me &&
          (adding ? (
            <LongLeaveForm busy={busy} onSubmit={(v) => submit(null, v)} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={() => setAdding(true)}>
              長期有休を登録する
            </button>
          ))}
      </section>

      <section className="card">
        <h3 className="card-title">みんなの長期有休</h3>
        {longLeaves.length === 0 && <p className="empty">まだ登録はありません。</p>}
        <ul className="ll-list">
          {longLeaves.map((l) => {
            const mine = l.staff_id === me;
            if (editing?.id === l.id) {
              return (
                <li key={l.id} className="ll-item">
                  <LongLeaveForm initial={l} busy={busy} onSubmit={(v) => submit(l.id, v)} onCancel={() => setEditing(null)} />
                </li>
              );
            }
            return (
              <li key={l.id} className={`ll-item${mine ? ' mine' : ''}${l.end_date < today ? ' past' : ''}`}>
                <div className="ll-main">
                  <span className="mk mk-long" aria-hidden="true" />
                  <strong className="truncate">{staffName(l.staff_id)}</strong>
                  {mine && <span className="me-tag">自分</span>}
                </div>
                <p className="ll-range">
                  {shortDate(l.start_date)}〜{shortDate(l.end_date)}
                </p>
                {l.memo && <p className="pre-wrap muted">{l.memo}</p>}
                {mine && (
                  <div className="row-gap">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(l)}>
                      変更
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('この長期有休を削除しますか？'))
                          void run(() => api.deleteLongLeave(token, me!, l.id), '削除しました');
                      }}
                    >
                      削除
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
