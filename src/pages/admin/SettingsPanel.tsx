import { useState } from 'react';
import { useApp } from '../../AppContext';
import { api } from '../../lib/api';
import { PushSettings } from './PushSettings';

export function staffUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#k=${token}`;
}

export function SettingsPanel() {
  const { admin, adminSession, run, setToken, showToast, exitAdmin } = useApp();
  const [maxDays, setMaxDays] = useState(String(admin?.settings.max_days ?? 3));
  const [maxPerDay, setMaxPerDay] = useState(String(admin?.settings.max_per_day ?? 2));
  const [off, setOff] = useState(admin?.settings.off_symbol ?? '/');
  const [paid, setPaid] = useState(admin?.settings.paid_symbol ?? '有休');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  if (!admin || !adminSession) return null;
  const url = staffUrl(admin.settings.access_token);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    const ok = await run(fn, msg);
    setBusy(false);
    return ok;
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">スタッフ用URL</h2>
        <p className="muted small">このURLを知っている人だけが使えます。グループなどで共有してください。</p>
        <div className="url-box">
          <code>{url}</code>
        </div>
        <div className="btn-pair">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              navigator.clipboard.writeText(url).then(
                () => showToast('URLをコピーしました'),
                () => showToast('コピーできませんでした。長押しで選択してコピーしてください', 'error'),
              )
            }
          >
            URLをコピー
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('URLを作り直しますか？\n今までのURLは使えなくなります。新しいURLをスタッフにもう一度共有してください。'))
                return;
              setBusy(true);
              try {
                const t = await api.adminRegenerateToken(adminSession);
                setToken(t);
                showToast('新しいURLを作りました。スタッフに共有してください');
              } catch (e) {
                showToast(e instanceof Error ? e.message : '失敗しました', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            URLを再発行
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">ルールと記号</h2>
        <div className="form">
          <div className="field-pair">
            <label className="field">
              <span>希望休の上限（1人・月）</span>
              <input className="input" type="number" min={1} max={31} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
            </label>
            <label className="field">
              <span>同じ日の上限人数</span>
              <input className="input" type="number" min={1} max={20} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
            </label>
          </div>
          <div className="field-pair">
            <label className="field">
              <span>公休の記号（書き出し）</span>
              <input className="input" value={off} onChange={(e) => setOff(e.target.value)} />
            </label>
            <label className="field">
              <span>有休の記号（書き出し）</span>
              <input className="input" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => act(() => api.adminSaveSettings(adminSession, Number(maxDays), Number(maxPerDay), off, paid), '保存しました')}
          >
            保存する
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">管理者パスコードの変更</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== next2) {
              showToast('新しいパスコードが一致しません', 'error');
              return;
            }
            if (await act(() => api.adminChangePasscode(adminSession, cur, next), 'パスコードを変更しました')) {
              setCur('');
              setNext('');
              setNext2('');
            }
          }}
        >
          <label className="field">
            <span>今のパスコード</span>
            <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </label>
          <div className="field-pair">
            <label className="field">
              <span>新しいパスコード（4文字以上）</span>
              <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="field">
              <span>もう一度</span>
              <input className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !cur || next.length < 4}>
            変更する
          </button>
        </form>
      </section>

      <PushSettings />

      <section className="card">
        <h2 className="card-title">管理者モードの終了</h2>
        <p className="muted small">この端末の管理者モードを解除します（約30日たつと自動で解除されます）。</p>
        <button type="button" className="btn btn-outline btn-block" onClick={() => void exitAdmin()}>
          管理者モードを終了する
        </button>
      </section>
    </div>
  );
}
