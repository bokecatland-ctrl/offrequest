import { describe, expect, it } from 'vitest';
import { buildShiftRows, missingShiftNames, toCsv, toTsv } from './exportShift';
import type { AdminStaff, OffRequest } from './types';

const staff: AdminStaff[] = [
  { id: 'a', name: '高橋', shift_name: 'TAKAHASHI', sort_order: 1, active: true },
  { id: 'b', name: '鈴木', shift_name: 'SUZUKI', sort_order: 2, active: true },
  { id: 'c', name: '休止中', shift_name: 'X', sort_order: 3, active: false },
  { id: 'd', name: '中村', shift_name: '', sort_order: 4, active: true },
];

function req(staff_id: string, date: string, kind: 'off' | 'paid', status: 'pending' | 'confirmed' | null = null): OffRequest {
  return { id: staff_id + date, staff_id, date, kind, status, is_exception: false, created_at: '' };
}

describe('buildShiftRows', () => {
  const rows = buildShiftRows({
    month: '2026-11',
    staff,
    requests: [
      req('a', '2026-11-03', 'off'),
      req('a', '2026-11-12', 'off'),
      req('b', '2026-11-07', 'paid', 'pending'),
      req('b', '2026-11-08', 'paid', 'confirmed'),
    ],
    longLeaves: [{ id: 'l', staff_id: 'd', start_date: '2026-10-28', end_date: '2026-11-02', memo: '' }],
    offSymbol: '/',
    paidSymbol: '有休',
  });

  it('有効なスタッフだけ、並び順どおりに出す', () => {
    expect(rows.map((r) => r[0])).toEqual(['TAKAHASHI', 'SUZUKI', '']);
  });

  it('1列目が氏名、続けて31日分の列', () => {
    for (const r of rows) expect(r).toHaveLength(32);
  });

  it('希望休は「/」、正しい日付の列に入る', () => {
    expect(rows[0][3]).toBe('/');
    expect(rows[0][12]).toBe('/');
    expect(rows[0].filter((v) => v === '/')).toHaveLength(2);
  });

  it('要相談の希望有休は出さず、確認済みは「有休」', () => {
    expect(rows[1][7]).toBe('');
    expect(rows[1][8]).toBe('有休');
  });

  it('長期有休の期間は「有休」（月をまたぐ場合はその月の分だけ）', () => {
    expect(rows[2].slice(1, 4)).toEqual(['有休', '有休', '']);
  });

  it('30日の月は31日目が空', () => {
    expect(rows[0][31]).toBe('');
  });
});

describe('書き出し形式', () => {
  it('TSV はタブ区切り・見出しなし', () => {
    expect(toTsv([['A', '/', ''], ['B', '', '有休']])).toBe('A\t/\t\r\nB\t\t有休');
  });
  it('CSV は BOM 付き、必要なら引用符', () => {
    const csv = toCsv([['A,B', '/']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"A,B",/\r\n');
  });
  it('シフト表上の氏名の未設定を見つける', () => {
    expect(missingShiftNames(staff).map((s) => s.id)).toEqual(['d']);
  });
});
