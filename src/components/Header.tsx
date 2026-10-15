import { useState } from 'react';
import { useApp } from '../AppContext';
import { monthLabel } from '../lib/dates';
import { NameChangeForm } from './NamePicker';
import { PasscodeDialog } from './PasscodeDialog';
import { Sheet } from './Sheet';
import { useLongPress } from './useLongPress';

export function Header({ label = '希望休の入力' }: { label?: string }) {
  const { months, month, setMonth, staffId, staffName, adminSession, nameChange } = useApp();
  const [passOpen, setPassOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  // 管理者の入口：タイトルを長押し（見た目では目立たせない）
  const press = useLongPress(() => {
    if (!adminSession) setPassOpen(true);
  });

  const idx = months.findIndex((m) => m.month === month);
  const prev = idx > 0 ? months[idx - 1].month : null;
  const next = idx >= 0 && idx < months.length - 1 ? months[idx + 1].month : null;

  return (
    <header className="page-head">
      <div className="page-head-main">
        <p className="page-label no-select" {...press}>
          {label}
          {adminSession && <span className="admin-tag">管理者モード</span>}
        </p>
        <div className="month-row">
          {months.length > 1 && (
            <button type="button" className="icon-btn" disabled={!prev} onClick={() => prev && setMonth(prev)} aria-label="前の月">
              ‹
            </button>
          )}
          <h1 className="page-title">{month ? monthLabel(month) : '—'}</h1>
          {adminSession && months.find((m) => m.month === month)?.published === false && (
            <span className="unpub-tag">非公開</span>
          )}
          {months.length > 1 && (
            <button type="button" className="icon-btn" disabled={!next} onClick={() => next && setMonth(next)} aria-label="次の月">
              ›
            </button>
          )}
        </div>
      </div>
      {!adminSession && staffId && (
        <button type="button" className="name-chip" onClick={() => setNameOpen(true)} aria-label={`${staffName(staffId)}（名前の変更申請）`}>
          <span className="truncate">{staffName(staffId)}</span>
          {nameChange && <span className="chip-pending">申請中</span>}
        </button>
      )}
      <PasscodeDialog open={passOpen} onClose={() => setPassOpen(false)} />
      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title="名前の変更申請">
        <NameChangeForm onDone={() => setNameOpen(false)} />
      </Sheet>
    </header>
  );
}
