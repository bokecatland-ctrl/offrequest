import { useEffect, useState } from 'react';

/** メディアクエリ（画面幅など）に合っているか */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** PC など、カレンダーのマスに名前を出せる広さ */
export const WIDE_CALENDAR = '(min-width: 900px)';
