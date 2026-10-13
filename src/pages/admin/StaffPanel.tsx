import { useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import type { AdminStaff } from '../../lib/types';

export function StaffPanel() {
  const { admin, adminSession, run } = useApp();
  const [name, setName] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!admin || !adminSession) return null;
  const staff = admin.staff;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    const ok = await run(fn, msg);
    setBusy(false);
    return ok;
  };

  const move = (i: number, d: -1 | 1) => {
    const ids = staff.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void act(() => api.adminReorderStaff(adminSession, ids), '並び順を変更しました');
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">スタッフを追加</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (await act(() => api.adminSaveStaff(adminSession, null, name, shiftName, true), `${name} を追加しました`)) {
              setName('');
              setShiftName('');
            }
          }}
        >
          <div className="field-pair">
            <label className="field">
              <span>表示名（アプリの名前一覧）</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：高橋" />
            </label>
            <label className="field">
              <span>シフト表上の氏名（Excel D列と完全一致）</span>
              <input className="input" value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="例：TAKAHASHI" />
            </label>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
            追加する
          </button>
        </form>
      </section>

      <section className="card">
        <h3 className="card-title">名簿（シフト表の行の順）</h3>
        <p className="muted small">
          並び順は、シフト表用の書き出しの行の順になります。シフト表の社員の行と同じ順に並べてください。
          「無効」にすると名前一覧と書き出しから外れます（入力済みのデータは残ります）。
        </p>
        {staff.length === 0 && <p className="empty">まだ登録されていません。</p>}
        <ul className="staff-list">
          {staff.map((s, i) => (
            <StaffRow
              key={s.id + s.name + s.shift_name + s.active}
              s={s}
              busy={busy}
              first={i === 0}
              last={i === staff.length - 1}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onSave={(n, sn, active) => act(() => api.adminSaveStaff(adminSession, s.id, n, sn, active), '保存しました')}
              onDelete={() => {
                if (
                  window.confirm(
                    `${s.name} を削除しますか？\nこの人の希望休・長期有休・コメントもすべて消えます（元に戻せません）。\n一時的に外すだけなら「無効」にしてください。`,
                  )
                )
                  void act(() => api.adminDeleteStaff(adminSession, s.id), '削除しました');
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function StaffRow({
  s,
  busy,
  first,
  last,
  onUp,
  onDown,
  onSave,
  onDelete,
}: {
  s: AdminStaff;
  busy: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onSave: (name: string, shiftName: string, active: boolean) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(s.name);
  const [shiftName, setShiftName] = useState(s.shift_name);
  const dirty = name !== s.name || shiftName !== s.shift_name;
  return (
    <li className={`staff-row${s.active ? '' : ' inactive'}`}>
      <div className="staff-order">
        <button type="button" className="icon-btn" disabled={busy || first} onClick={onUp} aria-label={`${s.name} を上へ`}>
          ↑
        </button>
        <button type="button" className="icon-btn" disabled={busy || last} onClick={onDown} aria-label={`${s.name} を下へ`}>
          ↓
        </button>
      </div>
      <input className="input" aria-label="表示名" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className={`input${shiftName.trim() ? '' : ' input-warn'}`}
        aria-label="シフト表上の氏名"
        placeholder="シフト表上の氏名（未設定）"
        value={shiftName}
        onChange={(e) => setShiftName(e.target.value)}
      />
      <div className="row-gap staff-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty || !name.trim()} onClick={() => onSave(name, shiftName, s.active)}>
          保存
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onSave(s.name, s.shift_name, !s.active)}>
          {s.active ? '無効にする' : '有効にする'}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>
          削除
        </button>
      </div>
    </li>
  );
}
