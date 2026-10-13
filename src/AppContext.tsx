import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './lib/api';
import { KEYS, load, save } from './lib/storage';
import type { AdminOverview, Bootstrap, LongLeave, MonthData } from './lib/types';

export type AppStatus = 'loading' | 'ready' | 'no_token' | 'invalid_token' | 'error';

interface AppValue {
  status: AppStatus;
  errorMessage: string;
  token: string;
  boot: Bootstrap | null;
  month: string | null;
  setMonth: (m: string) => void;
  data: MonthData | null;
  longLeaves: LongLeave[];
  staffId: string | null;
  setStaffId: (id: string | null) => void;
  staffName: (id: string) => string;
  adminSession: string | null;
  admin: AdminOverview | null;
  enterAdmin: (session: string, expires: string) => void;
  exitAdmin: () => Promise<void>;
  setToken: (token: string) => void;
  reload: () => Promise<void>;
  /** 操作を実行し、失敗したらメッセージを出す。成功したら再読み込みする。 */
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  toast: { text: string; kind: 'ok' | 'error' } | null;
  showToast: (text: string, kind?: 'ok' | 'error') => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider がありません');
  return v;
}

/** URL の #k=xxxx からトークンを取り出す（なければ前回のものを使う） */
function readToken(): string {
  const m = window.location.hash.match(/[#&]k=([0-9a-z]{16,})/i);
  if (m) {
    save(KEYS.token, m[1]);
    return m[1];
  }
  const saved = load(KEYS.token);
  if (saved) {
    // ホーム画面に追加したときに同じ URL になるよう、ハッシュに戻しておく
    window.history.replaceState(null, '', `#k=${saved}`);
    return saved;
  }
  return '';
}

/** 受付中の月（締切前で一番早い月）、なければ最後の月 */
function pickDefaultMonth(boot: Bootstrap): string | null {
  if (boot.months.length === 0) return null;
  const now = Date.now();
  const open = boot.months.find((m) => new Date(m.deadline).getTime() >= now);
  return (open ?? boot.months[boot.months.length - 1]).month;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(readToken);
  const [status, setStatus] = useState<AppStatus>(token ? 'loading' : 'no_token');
  const [errorMessage, setErrorMessage] = useState('');
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [month, setMonthState] = useState<string | null>(null);
  const [data, setData] = useState<MonthData | null>(null);
  const [longLeaves, setLongLeaves] = useState<LongLeave[]>([]);
  const [staffId, setStaffIdState] = useState<string | null>(() => load(KEYS.staffId));
  const [adminSession, setAdminSession] = useState<string | null>(() => {
    const s = load(KEYS.adminSession);
    const exp = load(KEYS.adminExpires);
    return s && exp && new Date(exp).getTime() > Date.now() ? s : null;
  });
  const [admin, setAdmin] = useState<AdminOverview | null>(null);
  const [toast, setToast] = useState<AppValue['toast']>(null);
  const toastTimer = useRef<number>();
  const monthRef = useRef<string | null>(null);

  const showToast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2500);
  }, []);

  const dropAdmin = useCallback(() => {
    setAdminSession(null);
    setAdmin(null);
    save(KEYS.adminSession, null);
    save(KEYS.adminExpires, null);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.hint === 'invalid_token') {
        setStatus('invalid_token');
        return;
      }
      if (e instanceof ApiError && e.hint === 'admin_session') {
        dropAdmin();
      }
      showToast(e instanceof Error ? e.message : '問題が発生しました。', 'error');
    },
    [dropAdmin, showToast],
  );

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const b = await api.bootstrap(token);
      setBoot(b);
      let m = monthRef.current;
      if (!m || !b.months.some((x) => x.month === m)) {
        m = pickDefaultMonth(b);
        monthRef.current = m;
        setMonthState(m);
      }
      const [d, ll] = await Promise.all([m ? api.month(token, m) : Promise.resolve(null), api.longLeaves(token)]);
      if (monthRef.current === m) setData(d);
      setLongLeaves(ll);
      if (adminSession) {
        try {
          setAdmin(await api.adminOverview(adminSession));
        } catch (e) {
          if (e instanceof ApiError && e.hint === 'admin_session') dropAdmin();
          else throw e;
        }
      }
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.hint === 'invalid_token') {
        setStatus('invalid_token');
      } else if (status === 'loading') {
        setErrorMessage(e instanceof Error ? e.message : '読み込みに失敗しました。');
        setStatus('error');
      } else {
        handleError(e);
      }
    }
  }, [token, adminSession, dropAdmin, handleError, status]);

  useEffect(() => {
    void reload();
    // 名前・セッションの切り替えでは再読み込みしない（reload の依存のうち token / adminSession だけを見る）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, adminSession]);

  // スマホでアプリに戻ってきたときに最新にする
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const setMonth = useCallback(
    (m: string) => {
      monthRef.current = m;
      setMonthState(m);
      setData(null);
      api.month(token, m).then(
        (d) => {
          if (monthRef.current === m) setData(d);
        },
        handleError,
      );
    },
    [token, handleError],
  );

  const setStaffId = useCallback((id: string | null) => {
    setStaffIdState(id);
    save(KEYS.staffId, id);
  }, []);

  // 名簿から消えた名前を選んでいたら、選び直してもらう
  useEffect(() => {
    if (boot && staffId && !boot.staff.some((s) => s.id === staffId)) setStaffId(null);
  }, [boot, staffId, setStaffId]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    boot?.staff.forEach((s) => map.set(s.id, s.name));
    admin?.staff.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [boot, admin]);
  const staffName = useCallback((id: string) => names.get(id) ?? '（名簿にない人）', [names]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      try {
        await fn();
        if (success) showToast(success);
        await reload();
        return true;
      } catch (e) {
        handleError(e);
        await reload();
        return false;
      }
    },
    [handleError, reload, showToast],
  );

  const enterAdmin = useCallback((session: string, expires: string) => {
    save(KEYS.adminSession, session);
    save(KEYS.adminExpires, expires);
    setAdminSession(session);
  }, []);

  const exitAdmin = useCallback(async () => {
    if (adminSession) await api.adminLogout(adminSession).catch(() => undefined);
    dropAdmin();
  }, [adminSession, dropAdmin]);

  const setToken = useCallback((t: string) => {
    save(KEYS.token, t);
    window.history.replaceState(null, '', `#k=${t}`);
    setTokenState(t);
  }, []);

  const value: AppValue = {
    status,
    errorMessage,
    token,
    boot,
    month,
    setMonth,
    data,
    longLeaves,
    staffId,
    setStaffId,
    staffName,
    adminSession: admin ? adminSession : null,
    admin,
    enterAdmin,
    exitAdmin,
    setToken,
    reload,
    run,
    toast,
    showToast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
