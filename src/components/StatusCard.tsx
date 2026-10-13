import { useApp } from '../AppContext';
import { deadlineLabel, deadlineRemaining } from '../lib/dates';
import { hasLongLeaveInMonth } from '../lib/monthView';

/** 自分の入力状況（残り日数）と締切。一番目立たせる */
export function StatusCard() {
  const { data, boot, staffId, adminSession } = useApp();
  if (!data || !boot) return null;
  const max = boot.settings.max_days;
  const used = staffId ? data.requests.filter((r) => r.staff_id === staffId && r.kind === 'off').length : 0;
  const left = Math.max(0, max - used);
  const long = staffId ? hasLongLeaveInMonth(data, staffId) : false;
  const showMine = !adminSession && staffId;

  return (
    <section className="card status-card" aria-label="入力状況">
      {showMine ? (
        <div>
          <p className="status-label">あなたの希望休（月{max}日まで）</p>
          {long ? (
            <p className="status-long">長期有休が入っている月です。希望休は管理者に相談してください。</p>
          ) : (
            <div className="status-row">
              <span className="dots-lg" aria-hidden="true">
                {Array.from({ length: Math.max(max, used) }, (_, i) => (
                  <span key={i} className={`dot-lg${i < used ? ' filled' : ''}`} />
                ))}
              </span>
              <strong className="status-left">{data.is_closed ? `${used}日` : `あと${left}日`}</strong>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="status-label">閲覧のみ（管理者モード）</p>
          <p className="status-sub">登録・変更は「管理」から行います。</p>
        </div>
      )}
      <div className="status-deadline">
        <p className="status-label">締切</p>
        <p className="deadline-date">{deadlineLabel(data.deadline)}</p>
        <p className={`deadline-left${data.is_closed ? ' closed' : ''}`}>{deadlineRemaining(data.deadline)}</p>
      </div>
      {data.is_closed && showMine && (
        <p className="status-closed">締切を過ぎたため閲覧のみです。変更は管理者に相談してください。</p>
      )}
    </section>
  );
}
