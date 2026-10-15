import { useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import { addMonths, dateOf, deadlineLabel, deadlineRemaining, monthLabel, todayTokyo, toTokyoDate, toTokyoTime, tokyoToIso } from '../../lib/dates';

/** 次に作る月の候補：設定済みの最後の月の翌月（なければ来月）。締切は前月25日 23:59 */
function suggest(months: string[]): { month: string; date: string; time: string } {
  const base = months.length ? months[months.length - 1] : todayTokyo().slice(0, 7);
  const month = addMonths(base, 1);
  return { month, date: dateOf(addMonths(month, -1), 25), time: '23:59' };
}

export function MonthsPanel() {
  const { admin, adminSession, run } = useApp();
  const [form, setForm] = useState(() => suggest((admin?.months ?? []).map((m) => m.month)));
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!admin || !adminSession) return null;

  const exists = admin.months.some((m) => m.month === form.month);

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () => api.adminSaveMonth(adminSession, form.month, tokyoToIso(form.date, form.time)),
      `${monthLabel(form.month)}を保存しました`,
    );
    setBusy(false);
    if (ok) {
      setEditing(null);
      setForm(suggest([...admin.months.map((m) => m.month), form.month].sort()));
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">{editing ? `${monthLabel(editing)}の締切を変更` : '月を作る'}</h2>
        <p className="muted">
          作った月は、はじめは<strong>非公開</strong>です（スタッフには見えません）。その間に長期有休・受付しない日を整え、
          下の一覧の「公開する」を押すと、スタッフが希望休を入力できるようになります。締切を過ぎると、スタッフは閲覧のみになります。
        </p>
        <div className="form">
          <label className="field">
            <span>対象月</span>
            <input
              className="input"
              type="month"
              value={form.month}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, month: e.target.value })}
            />
          </label>
          <div className="field-pair">
            <label className="field">
              <span>締切日</span>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="field">
              <span>締切時刻</span>
              <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
          </div>
          {exists && !editing && <p className="warn-box">この月はすでにあります。保存すると締切が変わります。</p>}
          <div className="row-gap">
            {editing && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(null);
                  setForm(suggest(admin.months.map((m) => m.month)));
                }}
              >
                やめる
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary grow"
              disabled={busy || !/^\d{4}-\d{2}$/.test(form.month) || !form.date || !form.time}
              onClick={save}
            >
              保存する
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">設定済みの月</h3>
        {admin.months.length === 0 && <p className="empty">まだありません。</p>}
        <ul className="admin-list">
          {[...admin.months].reverse().map((m) => ({ ...m, published: m.published !== false })).map((m) => (
            <li key={m.month}>
              <strong>{monthLabel(m.month)}</strong>
              {m.published ? <span className="pub-tag">公開中</span> : <span className="unpub-tag">非公開</span>}
              <span className="muted">
                締切 {deadlineLabel(m.deadline)}（{deadlineRemaining(m.deadline)}）
              </span>
              <span className="push-right row-gap">
                <button
                  type="button"
                  className={`btn btn-sm ${m.published ? 'btn-ghost' : 'btn-primary'}`}
                  disabled={busy}
                  onClick={async () => {
                    const msg = m.published
                      ? `${monthLabel(m.month)}を非公開に戻しますか？\nスタッフには見えなくなり、入力もできなくなります（入力済みの希望は残ります）。`
                      : `${monthLabel(m.month)}を公開しますか？\nスタッフが見られるようになり、希望休を入力できるようになります。`;
                    if (!window.confirm(msg)) return;
                    setBusy(true);
                    await run(
                      () => api.adminSetMonthPublished(adminSession, m.month, !m.published),
                      m.published ? '非公開にしました' : '公開しました',
                    );
                    setBusy(false);
                  }}
                >
                  {m.published ? '非公開に戻す' : '公開する'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setEditing(m.month);
                    setForm({ month: m.month, date: toTokyoDate(m.deadline), time: toTokyoTime(m.deadline) });
                  }}
                >
                  締切を変更
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
