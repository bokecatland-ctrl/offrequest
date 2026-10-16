// ホーム画面に追加したときの設定（Web アプリのマニフェスト）。
// iPhone の「Web アプリとして開く」などでは、ここの start_url から開かれる。
// URL の鍵（#k=…）を start_url に入れておかないと、鍵なしで開いて「このURLでは開けません」になるため、
// 画面側から ?k=鍵 を付けて読み込み、その鍵入りの start_url を返す。
// 鍵の正しさはここでは確かめない（開いたあとに DB 側で確かめる）。形だけ確認する。
export default function handler(req, res) {
  const k = typeof req.query?.k === 'string' ? req.query.k : '';
  const startUrl = /^[0-9a-z]{16,64}$/i.test(k) ? `/#k=${k}` : '/';
  const manifest = {
    name: 'みんなの希望休',
    short_name: 'みんなの希望休',
    id: '/',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: '#f1f3f4',
    theme_color: '#0f6b66',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).send(JSON.stringify(manifest));
}
