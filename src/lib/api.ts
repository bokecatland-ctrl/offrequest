import { createClient } from '@supabase/supabase-js';
import type {
  AdminOverview,
  AuditEntry,
  Bootstrap,
  LongLeave,
  MonthData,
  NameChange,
  NoteType,
  RequestKind,
} from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const apiConfigured = Boolean(url && key);

const supabase = apiConfigured
  ? createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export class ApiError extends Error {
  hint: string | null;
  constructor(message: string, hint: string | null) {
    super(message);
    this.hint = hint;
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new ApiError('サーバーの設定がされていません。', 'not_configured');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const msg = error.code === 'P0001' || /[ぁ-んァ-ン一-龥]/.test(error.message)
      ? error.message
      : '通信に失敗しました。電波の良いところで、もう一度お試しください。';
    throw new ApiError(msg, error.hint || null);
  }
  return data as T;
}

// ---- スタッフ ----
export const api = {
  bootstrap: (token: string) => rpc<Bootstrap>('get_bootstrap', { p_token: token }),
  month: (token: string, month: string) => rpc<MonthData>('get_month', { p_token: token, p_month: month }),
  longLeaves: (token: string) => rpc<LongLeave[]>('get_long_leaves', { p_token: token }),
  setRequest: (token: string, staffId: string, date: string, kind: RequestKind) =>
    rpc('staff_set_request', { p_token: token, p_staff_id: staffId, p_date: date, p_kind: kind }),
  cancelRequest: (token: string, staffId: string, date: string) =>
    rpc('staff_cancel_request', { p_token: token, p_staff_id: staffId, p_date: date }),
  saveNote: (token: string, staffId: string, date: string, type: NoteType, comment: string) =>
    rpc('staff_save_note', { p_token: token, p_staff_id: staffId, p_date: date, p_type: type, p_comment: comment }),
  saveMonthMemo: (token: string, staffId: string, month: string, memo: string) =>
    rpc('staff_save_month_memo', { p_token: token, p_staff_id: staffId, p_month: month, p_memo: memo }),

  requestNameChange: (token: string, deviceId: string, from: string | null, to: string) =>
    rpc('staff_request_name_change', { p_token: token, p_device_id: deviceId, p_from_staff_id: from, p_to_staff_id: to }),
  nameChangeStatus: (token: string, deviceId: string) =>
    rpc<NameChange | null>('staff_name_change_status', { p_token: token, p_device_id: deviceId }),
  ackNameChange: (token: string, deviceId: string, id: string) =>
    rpc('staff_ack_name_change', { p_token: token, p_device_id: deviceId, p_id: id }),
  cancelNameChange: (token: string, deviceId: string, id: string) =>
    rpc('staff_cancel_name_change', { p_token: token, p_device_id: deviceId, p_id: id }),

  // ---- 管理者 ----
  adminLogin: (token: string, passcode: string) =>
    rpc<{ ok: boolean; session?: string; expires_at?: string; message?: string; locked?: boolean }>(
      'admin_login', { p_token: token, p_passcode: passcode }),
  adminLogout: (session: string) => rpc('admin_logout', { p_session: session }),
  adminCheck: (session: string) => rpc<boolean>('admin_check', { p_session: session }),
  adminOverview: (session: string) => rpc<AdminOverview>('admin_get_overview', { p_session: session }),
  adminMonth: (session: string, month: string) =>
    rpc<MonthData>('admin_get_month', { p_session: session, p_month: month }),
  adminSetRequest: (session: string, staffId: string, date: string, kind: RequestKind, confirmed: boolean) =>
    rpc('admin_set_request', {
      p_session: session, p_staff_id: staffId, p_date: date, p_kind: kind, p_confirmed: confirmed,
    }),
  adminCancelRequest: (session: string, staffId: string, date: string) =>
    rpc('admin_cancel_request', { p_session: session, p_staff_id: staffId, p_date: date }),
  adminSetPaidStatus: (session: string, requestId: string, confirmed: boolean) =>
    rpc('admin_set_paid_status', { p_session: session, p_request_id: requestId, p_confirmed: confirmed }),
  adminSaveNote: (session: string, staffId: string, date: string, type: NoteType, comment: string) =>
    rpc('admin_save_note', { p_session: session, p_staff_id: staffId, p_date: date, p_type: type, p_comment: comment }),
  adminSaveMonthMemo: (session: string, staffId: string, month: string, memo: string) =>
    rpc('admin_save_month_memo', { p_session: session, p_staff_id: staffId, p_month: month, p_memo: memo }),
  adminLongLeaves: (session: string) => rpc<LongLeave[]>('admin_get_long_leaves', { p_session: session }),
  adminSaveLongLeave: (session: string, staffId: string, id: string | null, start: string, end: string, memo: string) =>
    rpc<{ id: string; removed: { date: string; kind: 'off' | 'paid' }[] }>('admin_save_long_leave', {
      p_session: session, p_staff_id: staffId, p_id: id, p_start: start, p_end: end, p_memo: memo,
    }),
  adminDeleteLongLeave: (session: string, id: string) =>
    rpc('admin_delete_long_leave', { p_session: session, p_id: id }),
  adminSaveMonth: (session: string, month: string, deadline: string) =>
    rpc('admin_save_month', { p_session: session, p_month: month, p_deadline: deadline }),
  adminSaveStaff: (session: string, id: string | null, name: string, shiftName: string, active: boolean) =>
    rpc<string>('admin_save_staff', {
      p_session: session, p_id: id, p_display_name: name, p_shift_name: shiftName, p_active: active,
    }),
  adminReorderStaff: (session: string, ids: string[]) =>
    rpc('admin_reorder_staff', { p_session: session, p_ids: ids }),
  adminDeleteStaff: (session: string, id: string) => rpc('admin_delete_staff', { p_session: session, p_id: id }),
  adminSaveSettings: (session: string, maxDays: number, maxPerDay: number, offSymbol: string, paidSymbol: string) =>
    rpc('admin_save_settings', {
      p_session: session, p_max_days: maxDays, p_max_per_day: maxPerDay,
      p_off_symbol: offSymbol, p_paid_symbol: paidSymbol,
    }),
  adminChangePasscode: (session: string, current: string, next: string) =>
    rpc('admin_change_passcode', { p_session: session, p_current: current, p_new: next }),
  adminRegenerateToken: (session: string) => rpc<string>('admin_regenerate_token', { p_session: session }),
  adminDecideNameChange: (session: string, id: string, approve: boolean) =>
    rpc('admin_decide_name_change', { p_session: session, p_id: id, p_approve: approve }),
  adminAudit: (session: string, limit = 200) =>
    rpc<AuditEntry[]>('admin_get_audit', { p_session: session, p_limit: limit }),
};
