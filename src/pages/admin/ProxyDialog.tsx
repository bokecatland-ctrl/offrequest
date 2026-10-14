import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { KindBadge } from '../../components/DayEntries';
import { NoteEditor } from '../../components/DaySheet';
import { Sheet } from '../../components/Sheet';
import { api } from '../../lib/api';
import { dateOf, longDate, monthDates } from '../../lib/dates';
import { hasLongLeaveInMonth } from '../../lib/monthView';
import { NOTE_LABEL, type NoteType } from '../../lib/types';

interface Props {
  open: boolean;
  initialStaffId?: string;
  initialDate?: string;
  onClose: () => void;
}

/** 管理者の代行登録（上限超え・3人目・締切後の変更もできる） */
export function ProxyDialog({ open, initialStaffId, initialDate, onClose }: Props) {
  const { data, admin, adminSession, run, staffName } = useApp();
  const [staffId, setStaffId] = useState(initialStaffId ?? '');
  const [date, setDate] = useState(initialDate ?? '');
  const [busy, setBusy] = useState(false);
  const [openNote, setOpenNote] = useState<NoteType | null>(null);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (open) {
      setStaffId(initialStaffId ?? '');
      setDate(initialDate ?? (data ? dateOf(data.month, 1) : ''));
      setOpenNote(null);
    }
  }, [open, initialStaffId, initialDate, data]);

  const savedMemo = data?.memos.find((m) => m.staff_id === staffId)?.memo ?? '';
  useEffect(() => setMemo(savedMemo), [savedMemo, staffId]);

  if (!open || !data || !admin || !adminSession) return null;
  const s = admin.settings;
  const req = data.requests.find((r) => r.staff_id === staffId && r.date === date);
  const used = data.requests.filter((r) => r.staff_id === staffId && r.kind === 'off' && r.date !== date).length;
  const onDay = data.requests.filter((r) => r.date === date && r.kind === 'off' && r.staff_id !== staffId);
  const long = staffId ? hasLongLeaveInMonth(data, staffId) : false;
  const notes = data.notes.filter((n) => n.staff_id === staffId && n.date === date);

  // 希望休にした場合に例外になる理由
  const reasons: string[] = [];
  if (data.is_closed) reasons.push('締切後');
  if (used >= s.max_days) reasons.push(`月${s.max_days}日を超える`);
  if (onDay.length >= s.max_per_day) reasons.push(`同じ日の${onDay.length + 1}人目`);
  if (long) reasons.push('長期有休が入っている月');
  const blocked = (data.blocked_days ?? []).find((b) => b.date === date);
  if (blocked) reasons.push(`受付しない日${blocked.reason ? `（${blocked.reason}）` : ''}`);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    await run(fn, msg);
    setBusy(false);
  };

  const ready = !!staffId && !!date;

  return (
    <Sheet open onClose={onClose} title="代行で登録する" subtitle="上限超え・3人目・締切後の変更も登録できます">
      <div className="form">
        <label className="field">
          <span>名前</span>
          <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">選んでください</option>
            {admin.staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.active ? '' : '（無効）'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>日付</span>
          <select className="input" value={date} onChange={(e) => setDate(e.target.value)}>
            {monthDates(data.month).map((d) => (
              <option key={d} value={d}>
                {longDate(d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {ready && (
        <>
          <div className="info-box">
            <p>
              <strong>{staffName(staffId)}</strong> ・ {longDate(date)}：
              {req ? <KindBadge r={req} /> : <span className="muted">登録なし</span>}
              {req?.is_exception && <span className="badge badge-exc">例外</span>}
            </p>
            <p className="muted">
              この日の希望休：{onDay.length ? onDay.map((r) => staffName(r.staff_id)).join('・') : 'なし'}
              ／この人の希望休：ほかに{used}日
            </p>
          </div>
          {reasons.length > 0 && req?.kind !== 'off' && (
            <p className="warn-box">希望休にすると例外登録になります（{reasons.join('・')}）。</p>
          )}

          <div className="actions">
            {req?.kind !== 'off' && (
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy}
                onClick={() => act(() => api.adminSetRequest(adminSession, staffId, date, 'off', false), '希望休を代行登録しました')}
              >
                希望休にする{reasons.length ? '（例外）' : ''}
              </button>
            )}
            {!(req?.kind === 'paid' && req.status === 'confirmed') && (
              <button
                type="button"
                className="btn btn-paid btn-block"
                disabled={busy}
                onClick={() =>
                  act(() => api.adminSetRequest(adminSession, staffId, date, 'paid', true), '希望有休（確認済み）を代行登録しました')
                }
              >
                希望有休（確認済み）にする
              </button>
            )}
            {req && (
              <button
                type="button"
                className="btn btn-danger btn-block"
                disabled={busy}
                onClick={() => act(() => api.adminCancelRequest(adminSession, staffId, date), '取り消しました')}
              >
                {req.kind === 'off' ? '希望休' : '希望有休'}を取り消す
              </button>
            )}

            <div className="btn-pair">
              {(['shift', 'plan'] as NoteType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`btn btn-outline${openNote === t ? ' active' : ''}`}
                  aria-expanded={openNote === t}
                  onClick={() => setOpenNote(openNote === t ? null : t)}
                >
                  {notes.some((n) => n.type === t) && '✓ '}
                  {NOTE_LABEL[t]}
                </button>
              ))}
            </div>
            {openNote && (
              <NoteEditor
                key={openNote + staffId + date}
                type={openNote}
                initial={notes.find((n) => n.type === openNote)?.comment ?? ''}
                busy={busy}
                onSave={async (text) => {
                  setBusy(true);
                  const ok = await run(
                    () => api.adminSaveNote(adminSession, staffId, date, openNote, text),
                    `${NOTE_LABEL[openNote]}を保存しました`,
                  );
                  setBusy(false);
                  if (ok) setOpenNote(null);
                }}
              />
            )}
          </div>
        </>
      )}

      {staffId && (
        <div className="note-editor">
          <label className="note-editor-title" htmlFor="proxy-memo">
            今月全体のメモ（{staffName(staffId)}）
          </label>
          <textarea
            id="proxy-memo"
            className="input"
            rows={2}
            maxLength={1000}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={busy || memo.trim() === savedMemo.trim()}
            onClick={() => act(() => api.adminSaveMonthMemo(adminSession, staffId, data.month, memo), 'メモを保存しました')}
          >
            メモを保存する
          </button>
        </div>
      )}
    </Sheet>
  );
}
