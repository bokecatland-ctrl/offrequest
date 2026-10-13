import { useEffect, useState } from 'react';
import { useMedia } from './components/useMedia';
import { useApp } from './AppContext';
import { Header } from './components/Header';
import { NamePicker } from './components/NamePicker';
import { apiConfigured } from './lib/api';
import { AdminPage, ADMIN_SECTIONS, type AdminSection } from './pages/admin/AdminPage';
import { CalendarPage } from './pages/CalendarPage';
import { LongLeavePage } from './pages/LongLeavePage';
import { MinePage } from './pages/MinePage';

type Tab = 'calendar' | 'long' | 'mine' | 'admin';

const ICONS: Record<Tab, JSX.Element> = {
  calendar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  long: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </svg>
  ),
  mine: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  ),
};

const TAB_LABEL: Record<Tab, string> = { calendar: '希望休', long: '長期有休', mine: '自分', admin: '管理' };

export function App() {
  const { status, errorMessage, staffId, adminSession, toast, reload } = useApp();
  const [tab, setTab] = useState<Tab>('calendar');
  const [section, setSection] = useState<AdminSection>('overview');
  const wide = useMedia('(min-width: 1024px)');

  // 管理者モードが外れたら、管理タブから戻す
  useEffect(() => {
    if (!adminSession && tab === 'admin') setTab('calendar');
    if (adminSession && tab === 'mine') setTab('calendar');
  }, [adminSession, tab]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, section]);

  if (!apiConfigured) {
    return (
      <Message title="準備中です">
        サーバーの設定（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）がされていません。README の手順を確認してください。
      </Message>
    );
  }
  if (status === 'no_token' || status === 'invalid_token') {
    return (
      <Message title="このURLでは開けません">
        共有された最新のURLから開いてください。URLが変わった可能性があります。わからない場合は管理者に確認してください。
      </Message>
    );
  }
  if (status === 'error') {
    return (
      <Message title="読み込めませんでした">
        {errorMessage}
        <button type="button" className="btn btn-primary btn-block" onClick={() => void reload()}>
          もう一度読み込む
        </button>
      </Message>
    );
  }
  if (status === 'loading') return <div className="loading">読み込み中…</div>;

  const tabs: Tab[] = adminSession ? ['calendar', 'long', 'admin'] : ['calendar', 'long', 'mine'];
  const needName = !adminSession && !staffId;
  const adminWide = !!adminSession && wide;

  const content = needName ? (
    <NamePicker />
  ) : tab === 'calendar' ? (
    <CalendarPage />
  ) : tab === 'long' ? (
    <LongLeavePage />
  ) : tab === 'mine' ? (
    <MinePage />
  ) : (
    <>
      {!adminWide && (
        <nav className="section-chips" aria-label="管理メニュー">
          {ADMIN_SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`chip-btn${section === s.id ? ' active' : ''}`}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      )}
      <AdminPage section={section} />
    </>
  );

  return (
    <div className={`app${adminWide ? ' app-admin-wide' : ''} tab-${tab}`}>
      {adminWide && (
        <aside className="sidebar" aria-label="メニュー">
          <p className="sidebar-title">みんなの希望休</p>
          {(['calendar', 'long'] as Tab[]).map((t) => (
            <button
              type="button"
              key={t}
              className={`side-item${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {ICONS[t]}
              {TAB_LABEL[t]}
            </button>
          ))}
          <p className="side-group">{ICONS.admin}管理</p>
          {ADMIN_SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`side-item side-sub${tab === 'admin' && section === s.id ? ' active' : ''}`}
              onClick={() => {
                setTab('admin');
                setSection(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </aside>
      )}
      <main className="main">
        <Header label={tab === 'admin' ? '管理者画面' : undefined} />
        {content}
      </main>
      {!adminWide && !needName && (
        <nav className="tabbar" aria-label="メニュー">
          {tabs.map((t) => (
            <button
              type="button"
              key={t}
              className={`tab${tab === t ? ' active' : ''}`}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
            >
              {ICONS[t]}
              <span>{TAB_LABEL[t]}</span>
            </button>
          ))}
        </nav>
      )}
      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="message-page">
      <div className="card">
        <h1 className="card-title">{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}
