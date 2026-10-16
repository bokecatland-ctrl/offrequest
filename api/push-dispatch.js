// 通知の送信。
//   画面で操作したあと（公開・確認済みなど）と、毎朝の定期実行（vercel.json の crons）で呼ばれる。
//   DB から送る通知と宛先を受け取り（push_claim）、Web プッシュで送る。
//   環境変数 PUSH_KEYS（管理画面「通知の設定」で作る）＝「公開鍵.秘密鍵.合言葉」。
//   誰が呼んでも、送るのは DB に溜まっている通知だけなので害はない。
import webpush from 'web-push';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const [publicKey, privateKey, secret] = (process.env.PUSH_KEYS || '').trim().split('.');
  if (!publicKey || !privateKey || !secret || !SUPABASE_URL || !SUPABASE_KEY) {
    res.status(200).json({ ok: false, reason: 'not_configured' });
    return;
  }
  try {
    const host = req.headers?.host || 'localhost';
    webpush.setVapidDetails(`https://${host}`, publicKey, privateKey);
    const items = (await rpc('push_claim', { p_secret: secret })) || [];
    const gone = [];
    let sent = 0;
    await Promise.all(
      items.map(async (it) => {
        try {
          await webpush.sendNotification(
            { endpoint: it.endpoint, keys: { p256dh: it.p256dh, auth: it.auth } },
            JSON.stringify({ title: it.title, body: it.body }),
            { TTL: 60 * 60 * 24, urgency: 'normal' },
          );
          sent++;
        } catch (e) {
          // 404 / 410 は、スマホ側で通知をやめた・登録が切れた宛先
          if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(it.endpoint);
          else console.error('push failed', e?.statusCode, e?.body || e?.message);
        }
      }),
    );
    if (gone.length) await rpc('push_report', { p_secret: secret, p_gone: gone });
    res.status(200).json({ ok: true, sent, gone: gone.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
}
