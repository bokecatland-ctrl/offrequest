import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import { formatDateTime, shortDate } from '../../lib/dates';
import type { AuditEntry } from '../../lib/types';

const ACTION: Record<string, string> = {
  set_request: '登録',
  cancel_request: '取消',
  save_note: 'コメント保存',
  delete_note: 'コメント削除',
  save_month_memo: '月のメモ',
  save_long_leave: '長期有休の保存',
  delete_long_leave: '長期有休の削除',
  set_paid_status: '希望有休の確認',
  auto_cancel_request: '長期有休による自動取消',
  request_name_change: '名前の変更申請',
  approve_name_change: '名前の変更を承認',
  reject_name_change: '名前の変更を却下',
  save_month: '月の設定',
  save_blocked_days: '受付しない日の登録',
  delete_blocked_days: '受付しない日の解除',
  save_staff: '名簿の保存',
  reorder_staff: '並び順の変更',
  delete_staff: '名簿の削除',
  save_settings: '設定の変更',
  change_passcode: 'パスコード変更',
  regenerate_token: 'URL再発行',
  admin_login: '管理者ログイン',
  admin_login_failed: 'パスコード間違い',
  setup_app: '初期設定',
};
const ACTOR: Record<string, string> = { staff: '本人', admin: '管理者', system: 'システム' };
const KIND: Record<string, string> = { off: '希望休', paid: '希望有休' };

function describe(e: AuditEntry): string {
  const d = e.detail as Record<string, string | boolean | null>;
  const parts: string[] = [];
  if (typeof d.date === 'string') parts.push(shortDate(d.date));
  if (typeof d.kind === 'string') parts.push(KIND[d.kind] ?? d.kind);
  if (d.status === 'confirmed') parts.push('確認済み');
  if (d.status === 'pending' && e.action !== 'cancel_request') parts.push('要相談');
  if (d.is_exception === true) parts.push('例外');
  if (typeof d.type === 'string') parts.push(d.type === 'shift' ? '出勤時間希望' : '予定あり');
  if (typeof d.comment === 'string') parts.push(`「${d.comment}」`);
  if (typeof d.start_date === 'string' && typeof d.end_date === 'string')
    parts.push(`${shortDate(d.start_date)}〜${shortDate(d.end_date)}`);
  const removed = (e.detail as { removed?: { date: string; kind: string }[] }).removed;
  if (Array.isArray(removed)) parts.push('外した希望：' + removed.map((r) => `${shortDate(r.date)} ${KIND[r.kind] ?? r.kind}`).join('、'));
  if (typeof d.reason === 'string' && d.reason) parts.push(`（${d.reason}）`);
  if (typeof d.month === 'string') parts.push(d.month);
  if (typeof d.display_name === 'string') parts.push(d.display_name);
  return parts.join(' ');
}

export function AuditPanel() {
  const { adminSession, showToast } = useApp();
  const [list, setList] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    if (adminSession)
      api.adminAudit(adminSession, 300).then(setList, (e) => showToast(e instanceof Error ? e.message : '読み込めませんでした', 'error'));
  }, [adminSession, showToast]);

  return (
    <section className="card">
      <h2 className="card-title">操作履歴（新しい順・300件まで）</h2>
      {!list && <p className="muted">読み込み中…</p>}
      {list && (
        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>操作した人</th>
                <th>対象</th>
                <th>操作</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.at)}</td>
                  <td>{ACTOR[e.actor] ?? e.actor}</td>
                  <td>{e.staff_name ?? (e.staff_id ? '（削除済み）' : '—')}</td>
                  <td>{ACTION[e.action] ?? e.action}</td>
                  <td>{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
