import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import { deadlineLabel, deadlineRemaining, formatDateTime, parts, shortDate } from '../../lib/dates';
import { buildDays, hasInput, hasLongLeaveInMonth } from '../../lib/monthView';
import { NOTE_LABEL } from '../../lib/types';
import { MonthTable } from './MonthTable';
import { ProxyDialog } from './ProxyDialog';

export function Overview() {
  const { data, admin, adminSession, run, staffName } = useApp();
  const [publishing, setPublishing] = useState(false);
  const [proxy, setProxy] = useState<{ staffId?: string; date?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => (data ? buildDays(data) : null), [data]);

  if (!admin || !adminSession) return null;
  if (!data || !days) return <p className="empty card">月が設定されていません。「月の設定」から作成してください。</p>;

  const s = admin.settings;
  const active = admin.staff.filter((x) => x.active);
  const entered = active.filter((x) => hasInput(data, x.id));
  const notEntered = active.filter((x) => !hasInput(data, x.id));
  const pending = data.requests.filter((r) => r.kind === 'paid' && r.status === 'pending');
  const confirmed = data.requests.filter((r) => r.kind === 'paid' && r.status === 'confirmed');
  const fullDays = [...days.values()].filter((d) => d.offs.length >= s.max_per_day);
  const exceptions = data.requests.filter((r) => r.is_exception);
  const blockedDates = new Map((data.blocked_days ?? []).map((b) => [b.date, b.reason]));
  const onBlocked = data.requests.filter((r) => blockedDates.has(r.date) && !r.is_exception);

  const setPaid = async (id: string, confirmed: boolean) => {
    setBusy(true);
    await run(() => api.adminSetPaidStatus(adminSession, id, confirmed), confirmed ? '確認済みにしました' : '要相談に戻しました');
    setBusy(false);
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(true);
    await run(() => api.adminDecideNameChange(adminSession, id, approve), approve ? '承認しました' : '却下しました');
    setBusy(false);
  };

  return (
    <div className="admin-overview">
      {admin.months.find((m) => m.month === data.month)?.published === false && (
        <section className="card card-attention">
          <h3 className="card-title">
            <span className="unpub-tag">非公開</span> この月はまだスタッフに見えていません
          </h3>
          <p className="muted small">
            長期有休・受付しない日などを整えてから公開してください。公開すると、スタッフが希望休を入力できるようになります。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={publishing}
            onClick={async () => {
              if (!window.confirm('この月を公開しますか？\nスタッフが見られるようになり、希望休を入力できるようになります。')) return;
              setPublishing(true);
              await run(() => api.adminSetMonthPublished(adminSession, data.month, true), '公開しました');
              setPublishing(false);
            }}
          >
            この月を公開する
          </button>
        </section>
      )}

      <div className="admin-toolbar">
        <p className="muted">
          締切 {deadlineLabel(data.deadline)}（{deadlineRemaining(data.deadline)}）
        </p>
        <button type="button" className="btn btn-outline" onClick={() => setProxy({})}>
          代行で登録する（締切後・上限超え）
        </button>
      </div>

      {admin.name_changes.length > 0 && (
        <section className="card card-attention">
          <h3 className="card-title">
            名前の変更申請<span className="card-title-sub">{admin.name_changes.length}件</span>
          </h3>
          <p className="muted small">
            名前を間違えて選んだスタッフからの申請です。承認すると、そのスマホの名前が次に開いたときに切り替わります。
          </p>
          <ul className="admin-list">
            {admin.name_changes.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.from_staff_id ? staffName(c.from_staff_id) : '—'}</strong> → <strong>{staffName(c.to_staff_id)}</strong>
                </span>
                <span className="muted small">{formatDateTime(c.created_at)}</span>
                <span className="push-right row-gap">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide(c.id, false)}>
                    却下
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(c.id, true)}>
                    承認する
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onBlocked.length > 0 && (
        <section className="card card-attention">
          <h3 className="card-title">
            受付しない日に入っている希望<span className="card-title-sub">{onBlocked.length}件</span>
          </h3>
          <p className="muted small">受付しない日にする前から入っていた希望です。必要なら本人と相談し、マスを押して取り消してください。</p>
          <ul className="admin-list">
            {onBlocked.map((r) => (
              <li key={r.id}>
                <strong>{staffName(r.staff_id)}</strong>
                <span>{shortDate(r.date)}</span>
                <span className="muted small">{blockedDates.get(r.date) || '受付しない日'}</span>
                <span className={`badge ${r.kind === 'off' ? 'badge-off' : 'badge-paid-pending'}`}>{r.kind === 'off' ? '希望休' : '希望有休'}</span>
                <button type="button" className="btn btn-outline btn-sm push-right" onClick={() => setProxy({ staffId: r.staff_id, date: r.date })}>
                  確認・取り消し
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="admin-cards">
        <section className="card">
          <h3 className="card-title">
            希望休の入力状況
            <span className="big-num">
              {entered.length}
              <small> / {active.length}人</small>
            </span>
          </h3>
          {notEntered.length === 0 ? (
            <p className="muted">全員が入力しました。</p>
          ) : (
            <div className="chips">
              <span className="muted">未入力</span>
              {notEntered.map((x) => (
                <span key={x.id} className="chip">
                  {x.name}
                  {hasLongLeaveInMonth(data, x.id) ? '（長期有休あり）' : ''}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="card-title">
            要相談の希望有休<span className="card-title-sub">{pending.length}件</span>
          </h3>
          {pending.length === 0 && <p className="muted">ありません。</p>}
          <ul className="admin-list">
            {pending.map((r) => (
              <li key={r.id}>
                <span className="chip chip-paid">{staffName(r.staff_id)}</span>
                <span>{shortDate(r.date)}</span>
                <button type="button" className="btn btn-primary btn-sm push-right" disabled={busy} onClick={() => setPaid(r.id, true)}>
                  確認済みにする
                </button>
              </li>
            ))}
          </ul>
          {confirmed.length > 0 && (
            <details className="details">
              <summary>確認済み（{confirmed.length}件）</summary>
              <ul className="admin-list">
                {confirmed.map((r) => (
                  <li key={r.id}>
                    <span className="chip">{staffName(r.staff_id)}</span>
                    <span>{shortDate(r.date)}</span>
                    <button type="button" className="btn btn-ghost btn-sm push-right" disabled={busy} onClick={() => setPaid(r.id, false)}>
                      要相談に戻す
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card">
          <h3 className="card-title">満員の日（{s.max_per_day}人入っている日）</h3>
          {fullDays.length === 0 && <p className="muted">ありません。</p>}
          <div className="chips">
            {fullDays.map((d) => (
              <span key={d.date} className="chip">
                {parts(d.date).d}日 {d.offs.map((r) => staffName(r.staff_id)).join('・')}
              </span>
            ))}
          </div>
          {exceptions.length > 0 && (
            <p className="muted small">
              例外登録：
              {exceptions.map((r) => `${staffName(r.staff_id)} ${parts(r.date).d}日`).join('、')}
            </p>
          )}
        </section>

        <section className="card">
          <h3 className="card-title">
            出勤時間希望・予定あり<span className="card-title-sub">{data.notes.length}件</span>
          </h3>
          {data.notes.length === 0 && <p className="muted">ありません。</p>}
          <ul className="admin-list notes">
            {data.notes.map((n) => (
              <li key={n.id}>
                <strong>{staffName(n.staff_id)}</strong>
                <span>{parts(n.date).d}日</span>
                <span className={`badge badge-note-${n.type}`}>{NOTE_LABEL[n.type]}</span>
                <span className="entry-comment">{n.comment}</span>
              </li>
            ))}
          </ul>
          {data.memos.length > 0 && (
            <>
              <h4 className="sub-title">今月全体のメモ</h4>
              <ul className="admin-list notes">
                {data.memos.map((m) => (
                  <li key={m.staff_id}>
                    <strong>{staffName(m.staff_id)}</strong>
                    <span className="entry-comment pre-wrap">{m.memo}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h3 className="card-title">全員の月間一覧</h3>
        <p className="muted small">
          休＝希望休　有＝希望有休（確認済み）　有?＝希望有休（要相談）　長＝長期有休　◆＝出勤時間希望・予定あり　!＝例外登録　斜線の列＝受付しない日。
          マスを押すと代行登録できます。
        </p>
        <MonthTable
          data={data}
          staff={admin.staff}
          days={days}
          maxDays={s.max_days}
          maxPerDay={s.max_per_day}
          onCell={(staffId, date) => setProxy({ staffId, date })}
        />
      </section>

      <ProxyDialog
        open={!!proxy}
        initialStaffId={proxy?.staffId}
        initialDate={proxy?.date}
        onClose={() => setProxy(null)}
      />
    </div>
  );
}
