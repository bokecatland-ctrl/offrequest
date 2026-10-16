import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { KindBadge } from '../components/DayEntries';
import { NotifyCard } from '../components/NotifyCard';
import { api } from '../lib/api';
import { monthLabel, shortDate } from '../lib/dates';
import { NOTE_LABEL } from '../lib/types';

export function MinePage() {
  const { data, staffId, token, run, boot } = useApp();
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = data?.memos.find((m) => m.staff_id === staffId)?.memo ?? '';
  useEffect(() => setMemo(saved), [saved]);

  if (!data || !staffId || !boot) return null;
  const closed = data.is_closed;
  const reqs = data.requests.filter((r) => r.staff_id === staffId);
  const notes = data.notes.filter((n) => n.staff_id === staffId);
  const offCount = reqs.filter((r) => r.kind === 'off').length;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    await run(fn, msg);
    setBusy(false);
  };

  return (
    <>
      <NotifyCard />
      <p className="info-box">希望休も、出勤時間希望・予定あり・メモも、全員に見えます。</p>

      <section className="card">
        <h2 className="card-title">
          {monthLabel(data.month)}の自分の希望
          <span className="card-title-sub">
            希望休 {offCount}/{boot.settings.max_days}日
          </span>
        </h2>
        {reqs.length === 0 && <p className="empty">まだ入れていません。カレンダーの日付をタップして登録します。</p>}
        <ul className="mine-list">
          {reqs.map((r) => (
            <li key={r.id}>
              <span className="mine-date">{shortDate(r.date)}</span>
              <KindBadge r={r} />
              {!closed && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm push-right"
                  disabled={busy}
                  onClick={() => act(() => api.cancelRequest(token, staffId, r.date), '取り消しました')}
                >
                  取り消す
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">出勤時間希望・予定あり</h2>
        {notes.length === 0 && <p className="empty">まだありません。カレンダーの日付から書けます。</p>}
        <ul className="mine-list">
          {notes.map((n) => (
            <li key={n.id} className="wrap">
              <span className="mine-date">{shortDate(n.date)}</span>
              <span className={`badge badge-note-${n.type}`}>{NOTE_LABEL[n.type]}</span>
              <span className="entry-comment grow">{n.comment}</span>
              {!closed && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm push-right"
                  disabled={busy}
                  onClick={() => act(() => api.saveNote(token, staffId, n.date, n.type, ''), '削除しました')}
                >
                  削除
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">今月全体のメモ</h2>
        <p className="muted">リスト表示の上に、全員分が並びます。</p>
        <textarea
          className="input"
          rows={3}
          maxLength={1000}
          disabled={closed}
          placeholder="例：後半は夜が多めでも大丈夫です"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          aria-label="今月全体のメモ"
        />
        {!closed && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || memo.trim() === saved.trim()}
            onClick={() => act(() => api.saveMonthMemo(token, staffId, data.month, memo), 'メモを保存しました')}
          >
            メモを保存する
          </button>
        )}
        {closed && <p className="muted">締切を過ぎたため変更できません。</p>}
      </section>
    </>
  );
}
