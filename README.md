# みんなの希望休

ラウンジの月ごとの希望休を、スマホから入力・集計するアプリです（仕様は社内の仕様書を参照）。

- フロント：React + Vite（TypeScript）
- DB・ルール判定：Supabase（PostgreSQL の DB 関数）
- 公開：Vercel

## しくみ（大事なところ）

- テーブルは画面から直接読み書きできません（RLS 有効・ポリシーなし・権限なし）。
  読み書きはすべて `supabase/migrations/0001_init.sql` の DB 関数を通ります。
- 「月3日まで」「同じ日2人まで」「締切」「長期有休の月は希望休不可」は、DB 関数の中で
  月ごとのロックをかけて判定します。同時に押されても、先に処理された方だけが通ります。
- スタッフはログインなし。URL の `#k=…` の部分（推測できないランダムな文字列）を知っている人だけが使えます。
  管理者は「URL・設定」から再発行でき、古い URL は使えなくなります。
- 管理者は、画面上部の「希望休の入力」を約0.7秒長押し → パスコード。5回間違えると15分ロック。
  その端末では30日間、管理者モードが続きます。
- 登録・変更・取消はすべて操作履歴（audit_log）に残ります。
- スタッフの名前は、初回に「選ぶ → 確定」の2段階で決め、そのスマホに記憶します。あとから自由には変えられません。
  間違えた場合は、右上の名前から正しい名前を選んで申請し、管理者が「月間一覧」で承認すると切り替わります。
- 注意：ログインがないため、URL を知っている人は誰の名前でも選べます（仕様どおり）。
  名前のなりすましは操作履歴で確認できます。

## はじめての設定

### 1. Supabase

1. [Supabase](https://supabase.com/) で新しいプロジェクトを作る（リージョンは Tokyo がおすすめ）
2. 「SQL Editor」で `supabase/migrations/` の SQL を番号順（0001, 0002, …）に、中身を全部貼り付けて実行
3. 続けて、管理者パスコードを決めて次を実行（4文字以上）。結果に出る文字列がスタッフ用URLの鍵です

   ```sql
   select public.setup_app('ここに管理者パスコード');
   ```

   - パスコードを忘れたときも、同じ SQL で設定し直せます（URL は変わりません）
   - URL も作り直すときは `select public.setup_app('パスコード', true);`

4. 「Project Settings → API」の **Project URL** と **anon public key** を控える

### 2. Vercel

1. このリポジトリを Vercel にインポート（Framework は Vite が自動で選ばれます）
2. Environment Variables に次の2つを設定してデプロイ
   - `VITE_SUPABASE_URL` … Project URL
   - `VITE_SUPABASE_ANON_KEY` … anon public key
3. スタッフ用URLは `https://（Vercel のドメイン）/#k=（手順1-3 の文字列）`
   - 管理者モードの「URL・設定」からもコピーできます
   - 検索エンジンに載らないよう、`noindex`（meta と `X-Robots-Tag`）と robots.txt を設定済み

### 3. 管理者の初期作業

1. スタッフ用URLを開き、「希望休の入力」を長押し → パスコード
2. 「名簿」でスタッフを追加（表示名と、シフト表 D 列と完全一致の氏名）。シフト表の行の順に並べる
3. 「月の設定」で対象月と締切を作る
4. 「長期有休の登録」で、年単位で集めた長期有休を入れる（長期有休は管理者だけが登録できます）
5. スタッフ用URLをグループで共有

## 通知（任意）

スマホに通知を送れます（新しい月の公開・締切3日前と前日〈未入力の人〉・希望有休の確認・名前の変更の承認。
管理者には要相談の希望有休と名前の変更申請）。

1. 管理者モード →「URL・通知・設定」→「通知の鍵を作る」
2. 表示された値を、Vercel の Environment Variables に `PUSH_KEYS` として保存し、Redeploy
3. スタッフは「自分」タブの「通知を受け取る」を押す（iPhone はホーム画面に追加してから開く）

送信は Vercel の関数（`api/push-dispatch.js`）が行います。操作のたびと、毎朝9時ごろ（`vercel.json` の crons）に、
DB に溜まった通知を送ります。

## 毎月の流れ（管理者）

1. 「月の設定」で翌月を作る（締切は前月25日 23:59 が初期値）
2. 締切後、「月間一覧」で未入力者・要相談の希望有休を確認し、「確認済みにする」
3. 必要なら表のマスを押して代行登録（上限超え・3人目・締切後もできる。例外として記録）
4. 「シフト表用の書き出し」→「シフト表用にコピー」→ Excel の最初の社員の行の D 列を選び、
   「形式を選択して貼り付け」→「空白セルを無視する」で貼り付け

## 開発

```bash
npm install
npm run dev         # .env.local に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が必要
npm run typecheck
npm test            # シフト表書き出しのテスト
npm run build
```

### ローカルの PostgreSQL で動かす・テストする

Supabase を使わずに、ローカルの PostgreSQL（16 で確認）で DB 関数を確認できます。

```bash
export PGHOST=... PGPORT=...          # ローカルの PostgreSQL（ユーザー postgres）
supabase/tests/run_tests.sh            # ルール判定・同時操作のテスト（別DB offrequest_test を作り直す）

supabase/tests/reset_local.sh          # 開発用DB offrequest を作り直す
psql -U postgres -d offrequest -f supabase/tests/seed_demo.sql   # デモデータ（パスコード 1234）
PGDATABASE=offrequest npm run dev:local-api   # Supabase の RPC を真似する小さなサーバー（:54321）
# .env.local: VITE_SUPABASE_URL=http://localhost:54321 / VITE_SUPABASE_ANON_KEY=local
npm run dev
# http://localhost:5173/#k=demo0123456789abcdef0123456789ab
```

## ファイル

| 場所 | 内容 |
|---|---|
| `supabase/migrations/0001_init.sql` | テーブル・DB関数・権限（ルール判定はここ） |
| `supabase/tests/` | ルール判定・同時操作のテスト、デモデータ |
| `src/pages/` | スタッフ画面（希望休・長期有休・自分） |
| `src/pages/admin/` | 管理者画面（月間一覧・代行登録・書き出し・月の設定・名簿・設定・操作履歴） |
| `src/lib/exportShift.ts` | シフト表用の書き出し（TSV / BOM付きCSV） |
| `scripts/local-rpc-server.mjs` | ローカル確認用（本番では使わない） |
