import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { NotifyCard } from '../../components/NotifyCard';
import { api } from '../../lib/api';
import { generatePushKeys } from '../../lib/push';

type Status = Awaited<ReturnType<typeof api.adminPushStatus>>;

/** 通知の設定：鍵を作る → Vercel に貼る → 管理者自身の通知 */
export function PushSettings() {
  const { adminSession, run, showToast, boot } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [keys, setKeys] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (adminSession) api.adminPushStatus(adminSession).then(setStatus, () => setStatus(null));
  }, [adminSession, boot]);

  if (!adminSession) return null;
  const configured = status?.configured ?? false;

  const create = async () => {
    if (
      configured &&
      !window.confirm(
        '通知の鍵を作り直しますか？\n・Vercel の PUSH_KEYS も新しい値に貼り直して Redeploy が必要です\n・今までの通知の登録は使えなくなり、全員がもう一度「通知を受け取る」を押す必要があります',
      )
    )
      return;
    setBusy(true);
    try {
      const k = await generatePushKeys();
      const ok = await run(() => api.adminSetPushKeys(adminSession, k.publicKey, k.secret), '通知の鍵を作りました');
      if (ok) setKeys(`${k.publicKey}.${k.privateKey}.${k.secret}`);
    } catch {
      showToast('鍵を作れませんでした。別のブラウザ（Chrome など）でお試しください', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2 className="card-title">通知の設定</h2>
        {status && (
          <p className="muted small">
            {configured
              ? `通知を受け取っているスタッフ：${status.staff_people}人（${status.staff_devices}台）／管理者の端末：${status.admin_devices}台`
              : 'まだ設定されていません。下のボタンで鍵を作り、Vercel に貼り付けると使えるようになります。'}
          </p>
        )}

        {keys ? (
          <div className="stack">
            <p className="warn-box">
              この値は<strong>この画面でしか表示されません</strong>。いますぐ Vercel に貼り付けてください。
              （人に見せないでください）
            </p>
            <div className="url-box">
              <code>{keys}</code>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                navigator.clipboard.writeText(keys).then(
                  () => showToast('コピーしました'),
                  () => showToast('コピーできませんでした。長押しで選択してコピーしてください', 'error'),
                )
              }
            >
              値をコピー
            </button>
            <ol className="steps small">
              <li>Vercel のプロジェクト →「Settings」→「Environment Variables」を開く</li>
              <li>
                Key に <code>PUSH_KEYS</code>、Value にコピーした値を貼り付けて「Save」
                （すでにある場合は「Edit」で値を置き換える）
              </li>
              <li>「Deployments」→ いちばん上の「…」→「Redeploy」</li>
              <li>数分後、下の「通知を受け取る」→「テスト通知を送る」で届くか確かめる</li>
            </ol>
          </div>
        ) : (
          <button type="button" className={`btn ${configured ? 'btn-outline' : 'btn-primary'}`} disabled={busy} onClick={create}>
            {configured ? '通知の鍵を作り直す' : '通知の鍵を作る'}
          </button>
        )}
      </section>
      {configured && <NotifyCard admin />}
    </>
  );
}
