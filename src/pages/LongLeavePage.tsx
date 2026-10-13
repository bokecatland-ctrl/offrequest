import { useApp } from '../AppContext';
import { shortDate, todayTokyo } from '../lib/dates';

/** 長期有休の一覧（閲覧のみ。登録は管理者が「管理」から行う） */
export function LongLeavePage() {
  const { longLeaves, staffId, adminSession, staffName } = useApp();
  const me = adminSession ? null : staffId;
  const today = todayTokyo();

  return (
    <>
      <section className="card">
        <h2 className="card-title">長期有休</h2>
        <p className="muted">
          希望休とは別枠です。全員に見え、カレンダーにも表示されます。
          長期有休が入っている月の希望休は、管理者に相談してください。
        </p>
        <p className="info-box">
          {adminSession
            ? '登録・変更は「管理」→「長期有休の登録」から行います。'
            : '追加・変更はスプレッドシートにて行ってください。'}
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">みんなの長期有休</h3>
        {longLeaves.length === 0 && <p className="empty">まだ登録はありません。</p>}
        <ul className="ll-list">
          {longLeaves.map((l) => {
            const mine = l.staff_id === me;
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
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
