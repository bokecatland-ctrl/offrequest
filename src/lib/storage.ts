// localStorage は使えない環境（プライベートブラウズ等）もあるため、失敗しても止まらないようにする
export function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 保存できなくても動作は続ける
  }
}

export const KEYS = {
  token: 'offreq.token',
  staffId: 'offreq.staffId',
  adminSession: 'offreq.adminSession',
  adminExpires: 'offreq.adminExpires',
  view: 'offreq.view',
};
