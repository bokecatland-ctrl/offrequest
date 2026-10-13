// 日付はすべて日本時間（Asia/Tokyo）で扱う。
// 日付は 'YYYY-MM-DD'、月は 'YYYY-MM' の文字列。

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const tokyoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const tokyoTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 日時 → 日本時間の 'YYYY-MM-DD' */
export function toTokyoDate(iso: string | Date): string {
  return tokyoDate.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** ISO 日時 → 日本時間の 'HH:MM' */
export function toTokyoTime(iso: string | Date): string {
  return tokyoTime.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function todayTokyo(): string {
  return toTokyoDate(new Date());
}

export function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function dayOfWeek(date: string): number {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function dateOf(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function monthDates(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => dateOf(month, i + 1));
}

/** 'YYYY-MM-DD' 同士の日数差（b - a） */
export function diffDays(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 11/3（火） */
export function shortDate(date: string): string {
  const { m, d } = parts(date);
  return `${m}/${d}（${WEEKDAYS[dayOfWeek(date)]}）`;
}

/** 11月3日（火） */
export function longDate(date: string): string {
  const { m, d } = parts(date);
  return `${m}月${d}日（${WEEKDAYS[dayOfWeek(date)]}）`;
}

/** 締切の表示：10/25（日）、23:59 以外は時刻も付ける */
export function deadlineLabel(iso: string): string {
  const time = toTokyoTime(iso);
  const date = shortDate(toTokyoDate(iso));
  return time === '23:59' ? date : `${date} ${time}`;
}

/** 締切までの残り：あと12日 / 今日まで / 締切済み */
export function deadlineRemaining(iso: string, now = new Date()): string {
  if (now.getTime() > new Date(iso).getTime()) return '締切済み';
  const days = diffDays(toTokyoDate(now), toTokyoDate(iso));
  return days <= 0 ? '今日まで' : `あと${days}日`;
}

/** 日本時間の日付と時刻 → ISO（+09:00） */
export function tokyoToIso(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

export function overlapsMonth(start: string, end: string, month: string): boolean {
  return start <= dateOf(month, daysInMonth(month)) && end >= dateOf(month, 1);
}

export function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function formatDateTime(iso: string): string {
  const d = toTokyoDate(iso);
  const { m, d: day } = parts(d);
  return `${m}/${day} ${toTokyoTime(iso)}`;
}
