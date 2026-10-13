import { useState } from 'react';
import { useApp } from '../AppContext';
import { api } from '../lib/api';

/**
 * 初回の名前選択。選ぶ → 確定 の2段階にして、押し間違いを防ぐ。
 * 確定した名前はこのスマホに記憶し、あとから自由には変えられない（変更は管理者の承認制）。
 */
export function NamePicker() {
  const { boot, setStaffId } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const staff = boot?.staff ?? [];
  const pickedName = staff.find((s) => s.id === picked)?.name;

  return (
    <div className="name-picker">
      <p className="hint">あなたの名前を選んでください。</p>
      {staff.length === 0 && <p className="empty">名簿がまだ登録されていません。管理者に連絡してください。</p>}
      <div className="name-grid" role="radiogroup" aria-label="名前">
        {staff.map((s) => (
          <button
            type="button"
            role="radio"
            aria-checked={s.id === picked}
            key={s.id}
            className={`name-btn${s.id === picked ? ' selected' : ''}`}
            onClick={() => setPicked(s.id)}
          >
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>

      {picked && (
        <div className="confirm-bar" role="region" aria-label="名前の確定">
          <p>
            <strong className="confirm-name">{pickedName}</strong> さんで確定しますか？
          </p>
          <p className="muted small">確定すると、このスマホでは名前を変えられません。間違えた場合は管理者の承認が必要です。</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setStaffId(picked)}>
            この名前で確定する
          </button>
        </div>
      )}
    </div>
  );
}

/** 名前の変更申請（間違えて選んだときだけ）。管理者が承認すると切り替わる */
export function NameChangeForm({ onDone }: { onDone: () => void }) {
  const { boot, staffId, staffName, nameChange, token, deviceId, run } = useApp();
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = (boot?.staff ?? []).filter((s) => s.id !== staffId);

  if (nameChange) {
    return (
      <div className="stack">
        <div className="info-box">
          <p>
            申請中：<strong>{nameChange.from_staff_id ? staffName(nameChange.from_staff_id) : '—'}</strong> →{' '}
            <strong>{staffName(nameChange.to_staff_id)}</strong>
          </p>
          <p className="small">管理者の承認待ちです。承認されると、次に開いたときに切り替わります。</p>
        </div>
        <button
          type="button"
          className="btn btn-danger btn-block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run(() => api.cancelNameChange(token, deviceId, nameChange.id), '申請を取り消しました');
            setBusy(false);
          }}
        >
          申請を取り消す
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        今の名前：<strong>{staffId ? staffName(staffId) : '—'}</strong>
        <br />
        名前は自由には変えられません。間違えて選んだ場合は、正しい名前を選んで申請してください。管理者が承認すると切り替わります。
      </p>
      <div className="name-grid" role="radiogroup" aria-label="正しい名前">
        {others.map((s) => (
          <button
            type="button"
            role="radio"
            aria-checked={s.id === to}
            key={s.id}
            className={`name-btn${s.id === to ? ' selected' : ''}`}
            onClick={() => setTo(s.id)}
          >
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!to || busy}
        onClick={async () => {
          if (!to) return;
          setBusy(true);
          const ok = await run(
            () => api.requestNameChange(token, deviceId, staffId, to),
            '申請しました。管理者の承認をお待ちください',
          );
          setBusy(false);
          if (ok) onDone();
        }}
      >
        {to ? `「${staffName(to)}」への変更を申請する` : '正しい名前を選んでください'}
      </button>
    </div>
  );
}
