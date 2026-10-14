import { inRange, monthDates } from './dates';
import type { DayNote, LongLeave, MonthData, OffRequest } from './types';

export interface DayInfo {
  date: string;
  offs: OffRequest[];
  paids: OffRequest[];
  longs: LongLeave[];
  notes: DayNote[];
  /** 受付しない日なら理由（空文字のこともある）。受付する日は null */
  blocked: string | null;
}

export function buildDays(data: MonthData): Map<string, DayInfo> {
  const map = new Map<string, DayInfo>();
  for (const date of monthDates(data.month)) {
    map.set(date, { date, offs: [], paids: [], longs: [], notes: [], blocked: null });
  }
  for (const r of data.requests) {
    const day = map.get(r.date);
    if (!day) continue;
    (r.kind === 'off' ? day.offs : day.paids).push(r);
  }
  for (const n of data.notes) map.get(n.date)?.notes.push(n);
  for (const b of data.blocked_days ?? []) {
    const day = map.get(b.date);
    if (day) day.blocked = b.reason;
  }
  for (const l of data.long_leaves) {
    for (const day of map.values()) {
      if (inRange(day.date, l.start_date, l.end_date)) day.longs.push(l);
    }
  }
  return map;
}

export function hasAnything(day: DayInfo): boolean {
  return day.offs.length + day.paids.length + day.notes.length > 0;
}

/** その人がその月に長期有休を入れているか */
export function hasLongLeaveInMonth(data: MonthData, staffId: string): boolean {
  return data.long_leaves.some((l) => l.staff_id === staffId);
}

/** その人が月の中で何か入力しているか（未入力者の確認用） */
export function hasInput(data: MonthData, staffId: string): boolean {
  return (
    data.requests.some((r) => r.staff_id === staffId) ||
    data.notes.some((n) => n.staff_id === staffId) ||
    data.memos.some((m) => m.staff_id === staffId) ||
    data.long_leaves.some((l) => l.staff_id === staffId)
  );
}
