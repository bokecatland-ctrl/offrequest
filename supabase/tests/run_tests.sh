#!/usr/bin/env bash
# ルール判定・同時操作のテスト
#   使い方: PGHOST=... PGPORT=... supabase/tests/run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGDATABASE=offrequest_test
supabase/tests/reset_local.sh >/dev/null
psql -U postgres -X -v ON_ERROR_STOP=1 -f supabase/tests/rules_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'

echo "--- 同時操作：空き1枠に2人が同時に登録 ---"
# 準備：新しい3人を用意し、11/15 に1人入れておく
read -r TOKEN S1 S2 S3 < <(psql -U postgres -X -Atq -F' ' <<'SQL'
insert into public.staff (display_name, sort_order) values ('同時A', 101), ('同時B', 102), ('同時C', 103);
select s.access_token,
       (select id from public.staff where display_name = '同時A'),
       (select id from public.staff where display_name = '同時B'),
       (select id from public.staff where display_name = '同時C')
  from public.settings s;
SQL
)
psql -U postgres -X -Atq -v ON_ERROR_STOP=1 -c "set role anon; select public.staff_set_request('$TOKEN','$S1','2026-11-15','off')" >/dev/null

# A は登録後 2 秒間トランザクションを開いたままにする。B はその間に同じ日に登録する
( psql -U postgres -X -Atq -v ON_ERROR_STOP=1 -c "begin; set local role anon; select public.staff_set_request('$TOKEN','$S2','2026-11-15','off'); select pg_sleep(2); commit;" >/dev/null 2>&1 && echo "A: 登録できた" || echo "A: 弾かれた" ) &
sleep 0.5
( psql -U postgres -X -Atq -v ON_ERROR_STOP=1 -c "set role anon; select public.staff_set_request('$TOKEN','$S3','2026-11-15','off');" >/dev/null 2>&1 && echo "B: 登録できた" || echo "B: 弾かれた" ) &
wait
COUNT=$(psql -U postgres -X -Atq -c "select count(*) from public.requests where date='2026-11-15' and kind='off'")
if [ "$COUNT" = "2" ]; then echo "ok: 同時操作でも 2 人まで（count=$COUNT）"; else echo "FAIL: count=$COUNT"; exit 1; fi
echo "ALL OK"
