import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { LongLeaveForm } from '../../components/LongLeaveForm';
import { api } from '../../lib/api';
import { shortDate } from '../../lib/dates';
import type { LongLeave } from '../../lib/types';

/** 長期有休の代行登録（管理者は締切に関係なく登録・変更できる） */
export function LongLeaveAdmin() {
  const { admin, adminSession, run, staffName, longLeaves } = useApp();
  const [list, setList] = useState<LongLeave[]>(longLeaves);
  const [editing, setEditing] = useState<LongLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (adminSession) api.adminLongLeaves(adminSession).then(setList, () => undefined);
  }, [adminSession, longLeaves]);

  if (!admin || !adminSession) return null;
  const staffOptions = admin.staff.map((s) => ({ id: s.id, name: s.name }));

  const submit = async (id: string | null, v: { staffId: string | null; start: string; end: string; memo: string }) => {
    setBusy(true);
    const ok = await run(
      () => api.adminSaveLongLeave(adminSession, v.staffId!, id, v.start, v.end, v.memo),
      '長期有休を保存しました',
    );
    setBusy(false);
    if (ok) {
      setEditing(null);
      setFormKey((k) => k + 1);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">長期有休の代行登録</h2>
        <LongLeaveForm key={formKey} staffOptions={staffOptions} busy={busy} onSubmit={(v) => submit(null, v)} />
      </section>
      <section className="card">
        <h3 className="card-title">登録されている長期有休</h3>
        {list.length === 0 && <p className="empty">ありません。</p>}
        <ul className="ll-list">
          {list.map((l) =>
            editing?.id === l.id ? (
              <li key={l.id} className="ll-item">
                <LongLeaveForm
                  initial={l}
                  staffOptions={staffOptions}
                  busy={busy}
                  onSubmit={(v) => submit(l.id, v)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={l.id} className="ll-item">
                <div className="ll-main">
                  <span className="mk mk-long" aria-hidden="true" />
                  <strong>{staffName(l.staff_id)}</strong>
                  <span>
                    {shortDate(l.start_date)}〜{shortDate(l.end_date)}
                  </span>
                  <span className="push-right row-gap">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(l)}>
                      変更
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('この長期有休を削除しますか？'))
                          void run(() => api.adminDeleteLongLeave(adminSession, l.id), '削除しました');
                      }}
                    >
                      削除
                    </button>
                  </span>
                </div>
                {l.memo && <p className="pre-wrap muted">{l.memo}</p>}
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}
