import { useState } from 'react';
import type { LongLeave, Staff } from '../lib/types';

interface Props {
  initial?: LongLeave;
  /** 管理者の代行登録のときだけ、名前を選べる */
  staffOptions?: Staff[];
  busy: boolean;
  onSubmit: (v: { staffId: string | null; start: string; end: string; memo: string }) => void;
  onCancel?: () => void;
}

export function LongLeaveForm({ initial, staffOptions, busy, onSubmit, onCancel }: Props) {
  const [staffId, setStaffId] = useState(initial?.staff_id ?? '');
  const [start, setStart] = useState(initial?.start_date ?? '');
  const [end, setEnd] = useState(initial?.end_date ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const invalid = !start || !end || end < start || (staffOptions && !staffId);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onSubmit({ staffId: staffOptions ? staffId : null, start, end, memo });
      }}
    >
      {staffOptions && (
        <label className="field">
          <span>名前</span>
          <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">選んでください</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
          <span>終了日</span>
          <input className="input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {start && end && end < start && <p className="form-error">終了日は開始日より後の日付にしてください。</p>}
      <label className="field">
        <span>メモ（みんなに見えます）</span>
        <input className="input" value={memo} maxLength={500} placeholder="例：帰省" onChange={(e) => setMemo(e.target.value)} />
      </label>
      <div className="row-gap">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            やめる
          </button>
        )}
        <button type="submit" className="btn btn-primary grow" disabled={busy || !!invalid}>
          {initial ? '変更を保存する' : '登録する'}
        </button>
      </div>
    </form>
  );
}
