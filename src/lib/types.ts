export type RequestKind = 'off' | 'paid';
export type PaidStatus = 'pending' | 'confirmed';
export type NoteType = 'shift' | 'plan';

export interface Staff {
  id: string;
  name: string;
}

export interface AdminStaff extends Staff {
  shift_name: string;
  sort_order: number;
  active: boolean;
}

export interface MonthInfo {
  month: string; // YYYY-MM
  deadline: string; // ISO
}

export interface Bootstrap {
  now: string;
  settings: { max_days: number; max_per_day: number };
  staff: Staff[];
  months: MonthInfo[];
}

export interface AdminOverview {
  now: string;
  settings: {
    max_days: number;
    max_per_day: number;
    off_symbol: string;
    paid_symbol: string;
    access_token: string;
  };
  staff: AdminStaff[];
  months: MonthInfo[];
  name_changes: NameChange[];
}

export interface NameChange {
  id: string;
  status?: 'pending' | 'approved' | 'rejected';
  from_staff_id: string | null;
  to_staff_id: string;
  created_at: string;
}

export interface OffRequest {
  id: string;
  date: string; // YYYY-MM-DD
  staff_id: string;
  kind: RequestKind;
  status: PaidStatus | null;
  is_exception: boolean;
  created_at: string;
}

export interface LongLeave {
  id: string;
  staff_id: string;
  start_date: string;
  end_date: string;
  memo: string;
}

export interface DayNote {
  id: string;
  date: string;
  staff_id: string;
  type: NoteType;
  comment: string;
}

export interface MonthMemo {
  staff_id: string;
  memo: string;
  updated_at: string;
}

export interface MonthData {
  month: string;
  deadline: string;
  now: string;
  is_closed: boolean;
  requests: OffRequest[];
  long_leaves: LongLeave[];
  notes: DayNote[];
  memos: MonthMemo[];
  blocked_days: BlockedDay[];
}

/** 受付しない日（連休・年末年始など） */
export interface BlockedDay {
  date: string;
  reason: string;
}

export interface AdminBlockedDay extends BlockedDay {
  requests: { staff_id: string; kind: RequestKind; status: PaidStatus | null }[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  staff_id: string | null;
  staff_name: string | null;
  action: string;
  detail: Record<string, unknown>;
}

export const NOTE_LABEL: Record<NoteType, string> = {
  shift: '出勤時間希望',
  plan: '予定あり',
};
