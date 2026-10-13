import { dateOf, daysInMonth, inRange } from './dates';
import type { AdminStaff, LongLeave, OffRequest } from './types';

export interface ExportInput {
  month: string;
  staff: AdminStaff[]; // 並び順どおり
  requests: OffRequest[];
  longLeaves: LongLeave[];
  offSymbol: string;
  paidSymbol: string;
}

/**
 * シフト表（Excel）に貼り付ける行を作る。
 *   1列目：シフト表上の氏名（D列）、続けて 1日〜31日（E列〜AI列）。見出し行なし。
 *   希望休 → 公休の記号（/）、確認済みの希望有休・長期有休の期間 → 有休の記号、それ以外は空。
 *   要相談のままの希望有休は書き出さない。
 *   31日がない月も、列の位置がずれないよう 31 列そろえる。
 */
export function buildShiftRows(input: ExportInput): string[][] {
  const days = daysInMonth(input.month);
  return input.staff
    .filter((s) => s.active)
    .map((s) => {
      const row = [s.shift_name];
      for (let d = 1; d <= 31; d++) {
        if (d > days) {
          row.push('');
          continue;
        }
        const date = dateOf(input.month, d);
        const req = input.requests.find((r) => r.staff_id === s.id && r.date === date);
        if (req?.kind === 'off') row.push(input.offSymbol);
        else if (req?.kind === 'paid' && req.status === 'confirmed') row.push(input.paidSymbol);
        else if (input.longLeaves.some((l) => l.staff_id === s.id && inRange(date, l.start_date, l.end_date)))
          row.push(input.paidSymbol);
        else row.push('');
      }
      return row;
    });
}

function tsvCell(v: string): string {
  return v.replace(/[\t\r\n]/g, ' ');
}

export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(tsvCell).join('\t')).join('\r\n');
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Excel で文字化けしないよう BOM 付き UTF-8 */
export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** シフト表上の氏名が未設定の人 */
export function missingShiftNames(staff: AdminStaff[]): AdminStaff[] {
  return staff.filter((s) => s.active && !s.shift_name.trim());
}
