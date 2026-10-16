import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { api } from '../lib/api';
import { disablePush, dispatchPushNow, enableAdminPush, enableStaffPush, getPushState, type PushState } from '../lib/push';

const Bell = () => (
  <span className="bell" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  </span>
);

/**
 * 通知を受け取るカード。
 *   スタッフ：新しい月の公開・締切が近いとき・希望有休の確認・名前の変更の承認
 *   管理者（admin）：要相談の希望有休・名前の変更申請
 */
export function NotifyCard({ admin = false }: { admin?: boolean }) {
  const { boot, token, deviceId, staffId, adminSession, showToast } = useApp();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const publicKey = boot?.settings.push_public_key ?? null;

  useEffect(() => {
    if (publicKey) getPushState(publicKey).then(setState, () => setState('unsupported'));
  }, [publicKey]);

  // 管理者が通知の設定をまだしていない、または判定中
  if (!publicKey || state === null) return null;

  const enable = async () => {
    setBusy(true);
    try {
      if (admin && adminSession) await enableAdminPush(adminSession, deviceId, publicKey);
      else await enableStaffPush(token, deviceId, staffId, publicKey);
      setState('on');
      showToast('通知をオンにしました');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '通知をオンにできませんでした', 'error');
      setState(await getPushState(publicKey).catch(() => 'off' as PushState));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePush(token);
      setState('off');
      showToast('通知をオフにしました');
    } finally {
      setBusy(false);
    }
  };

  const desc = admin
    ? '要相談の希望有休や、名前の変更申請が届いたらお知らせします（この端末）。'
    : '新しい月の公開・締切3日前と前日（未入力のとき）・希望有休の確認をお知らせします。';

  if (state === 'on') {
    return (
      <section className="card">
        <div className="notify-on">
          <Bell />
          <strong>{admin ? '管理者向けの通知' : '通知'}</strong>
          <span className="notify-ok">✓ オン</span>
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={disable}>
            通知をオフにする
          </button>
          {admin && <TestButton />}
        </div>
      </section>
    );
  }

  return (
    <section className="card notify">
      <Bell />
      {state === 'ios_needs_home' ? (
        <>
          <span className="notify-title">通知を受け取るには</span>
          <span className="notify-desc">iPhone は、ホーム画面に追加してから開くと通知を受け取れます。</span>
          <ol className="steps notify-full">
            <li>
              下の <span className="share-icon" aria-label="共有" /> 共有ボタンを押す
            </li>
            <li>「ホーム画面に追加」を押す</li>
            <li>ホーム画面のアイコンから開き、「通知を受け取る」を押す</li>
          </ol>
        </>
      ) : state === 'unsupported' ? (
        <>
          <span className="notify-title">通知</span>
          <span className="notify-desc">このブラウザでは通知を受け取れません。Chrome や Safari で開いてください。</span>
        </>
      ) : state === 'denied' ? (
        <>
          <span className="notify-title">通知がブロックされています</span>
          <span className="notify-desc">
            受け取るには、スマホの設定（またはブラウザのサイト設定）で、このアプリの通知を許可してください。
          </span>
        </>
      ) : (
        <>
          <span className="notify-title">{admin ? '管理者向けの通知を受け取る' : '締切が近づいたら通知で知らせる'}</span>
          <span className="notify-desc">{desc}</span>
          <button type="button" className="btn btn-primary btn-block notify-full" disabled={busy} onClick={enable}>
            {busy ? '設定中…' : '通知を受け取る'}
          </button>
        </>
      )}
    </section>
  );
}

const DISPATCH_REASON: Record<string, string> = {
  not_configured: 'Vercel に PUSH_KEYS が設定されていません（設定後は Redeploy が必要です）',
  secret_mismatch: 'Vercel の PUSH_KEYS と、いまの通知の鍵が合っていません。鍵を作り直して、Vercel の値も貼り直してください',
  network: '送信の仕組みにつながりませんでした',
};

function TestButton() {
  const { adminSession, deviceId, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!adminSession) return;
        setBusy(true);
        try {
          await api.adminPushTest(adminSession, deviceId);
          const r = await dispatchPushNow();
          if (r.ok && r.sent) showToast('テスト通知を送りました（届くまで少しかかることがあります）');
          else if (r.ok) showToast('送り先が見つかりませんでした。「通知をオフにする」→「通知を受け取る」をやり直してください', 'error');
          else showToast(DISPATCH_REASON[r.reason ?? ''] ?? '送信に失敗しました', 'error');
        } catch (e) {
          showToast(e instanceof Error ? e.message : '送信に失敗しました', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      テスト通知を送る
    </button>
  );
}
