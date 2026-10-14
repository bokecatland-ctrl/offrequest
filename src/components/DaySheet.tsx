import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { api } from '../lib/api';
import { longDate } from '../lib/dates';
import { hasLongLeaveInMonth, type DayInfo } from '../lib/monthView';
import { NOTE_LABEL, type NoteType } from '../lib/types';
import { DayEntries } from './DayEntries';
import { Sheet } from './Sheet';

interface Props {
  day: DayInfo | null;
  onClose: () => void;
}

export function DaySheet({ day, onClose }: Props) {
  const { data, boot } = useApp();
  if (!day || !data || !boot) return null;
  const max = boot.settings.max_per_day;
  const n = day.offs.length;
  const subtitle = `希望休 ${n}/${max}${n >= max ? '・満員' : ''}${day.blocked !== null ? '・受付しない日' : ''}`;
  return (
    <Sheet open onClose={onClose} title={longDate(day.date)} subtitle={subtitle}>
      <DaySheetBody day={day} />
    </Sheet>
  );
}

function DaySheetBody({ day }: { day: DayInfo }) {
  const { data, boot, staffId, adminSession, token, run } = useApp();
  const [openNote, setOpenNote] = useState<NoteType | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data || !boot) return null;

  const maxPerDay = boot.settings.max_per_day;
  const maxDays = boot.settings.max_days;
  const me = adminSession ? null : staffId;
  const full = day.offs.length >= maxPerDay;
  const myReq = me ? [...day.offs, ...day.paids].find((r) => r.staff_id === me) : undefined;
  const used = me ? data.requests.filter((r) => r.staff_id === me && r.kind === 'off').length : 0;
  const long = me ? hasLongLeaveInMonth(data, me) : false;
  const canEdit = !!me && !data.is_closed;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    await run(fn, msg);
    setBusy(false);
  };

  // 受付しない日（案内は上に出し、希望休・希望有休のボタンは出さない）
  const blocked = day.blocked !== null;
  // 希望休を入れられない理由（画面側の表示用。最終判定はサーバー）
  const offBlock = blocked
    ? null
    : long
      ? '長期有休が入っているため、希望休は管理者に相談してください。'
      : full && myReq?.kind !== 'off'
        ? '満員です。入りたい場合は、入っている人と相談して、誰かが取り消すと空きます。'
        : used >= maxDays && myReq?.kind !== 'off'
          ? `希望休は月${maxDays}日まで入れています。ほかの日を取り消すと入れられます。`
          : null;

  return (
    <>
      {blocked && (
        <p className="info-box blocked-box">
          {day.blocked ? <strong>{day.blocked}</strong> : null}
          {day.blocked ? 'のため、' : ''}この日は希望休・希望有休を受け付けていません。出勤時間希望・予定ありは書けます。
        </p>
      )}
      <DayEntries day={day} meId={me} />

      {adminSession && <p className="info-box">管理者モードでは閲覧のみです。登録・変更は「管理」の代行登録から行います。</p>}
      {!adminSession && !me && <p className="info-box">登録するには、名前を選んでください。</p>}
      {me && data.is_closed && <p className="info-box">締切を過ぎたため閲覧のみです。変更は管理者に相談してください。</p>}

      {canEdit && (
        <div className="actions">
          {offBlock && <p className="info-box">{offBlock}</p>}

          {myReq?.kind === 'off' ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              disabled={busy}
              onClick={() => act(() => api.cancelRequest(token, me!, day.date), '希望休を取り消しました')}
            >
              希望休を取り消す
            </button>
          ) : (
            !offBlock &&
            !blocked && (
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy}
                onClick={() => act(() => api.setRequest(token, me!, day.date, 'off'), '希望休を登録しました')}
              >
                {myReq?.kind === 'paid' ? '希望休に変更する' : '希望休にする'}
              </button>
            )
          )}

          {myReq?.kind === 'paid' ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              disabled={busy}
              onClick={() => act(() => api.cancelRequest(token, me!, day.date), '希望有休を取り消しました')}
            >
              希望有休を取り消す
            </button>
          ) : (
            !blocked && (
            <button
              type="button"
              className="btn btn-paid btn-block"
              disabled={busy}
              onClick={() => act(() => api.setRequest(token, me!, day.date, 'paid'), '希望有休を登録しました（要相談）')}
            >
              {myReq?.kind === 'off' ? '希望有休に変更する（要相談）' : '希望有休にする（要相談）'}
            </button>
            )
          )}

          <div className="btn-pair">
            {(['shift', 'plan'] as NoteType[]).map((t) => {
              const has = day.notes.some((x) => x.staff_id === me && x.type === t);
              return (
                <button
                  type="button"
                  key={t}
                  className={`btn btn-outline${openNote === t ? ' active' : ''}`}
                  aria-expanded={openNote === t}
                  onClick={() => setOpenNote(openNote === t ? null : t)}
                >
                  {has && <span aria-label="記入済み">✓ </span>}
                  {NOTE_LABEL[t]}
                </button>
              );
            })}
          </div>
          {openNote && (
            <NoteEditor
              key={openNote}
              type={openNote}
              initial={day.notes.find((x) => x.staff_id === me && x.type === openNote)?.comment ?? ''}
              busy={busy}
              onSave={async (text) => {
                const ok = await run(
                  () => api.saveNote(token, me!, day.date, openNote, text),
                  text.trim() ? `${NOTE_LABEL[openNote]}を保存しました` : `${NOTE_LABEL[openNote]}を削除しました`,
                );
                if (ok) setOpenNote(null);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

export function NoteEditor({
  type,
  initial,
  busy,
  onSave,
}: {
  type: NoteType;
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const placeholder = type === 'shift' ? '例：泊まり明け希望、泊まりNG' : '例：潮風会 18:00〜、個人のミーティング';
  return (
    <div className="note-editor">
      <label className="note-editor-title" htmlFor={`note-${type}`}>
        {NOTE_LABEL[type]}（みんなに見えます）
      </label>
      <textarea
        id={`note-${type}`}
        className="input"
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-gap">
        {initial && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSave('')}>
            削除
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary grow"
          disabled={busy || text.trim() === initial.trim() || (!initial && !text.trim())}
          onClick={() => onSave(text)}
        >
          保存する
        </button>
      </div>
    </div>
  );
}
