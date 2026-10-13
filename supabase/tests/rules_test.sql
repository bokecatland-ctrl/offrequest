-- ルール判定のテスト（ローカル PostgreSQL 用）
--   supabase/tests/run_tests.sh から実行する
\set ON_ERROR_STOP 1
\set QUIET 1

-- 初期設定（SQL エディタから実行する想定の関数。postgres で実行）
select set_config('t.token', public.setup_app('1234'), false);

set role anon;

-- 画面のロールからテーブルを直接触れないこと
do $$ begin
  begin
    perform * from public.requests;
    raise exception 'FAIL: anon が requests を直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.settings;
    raise exception 'FAIL: anon が settings を直接読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.setup_app('9999');
    raise exception 'FAIL: anon が setup_app を呼べた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public._set_request(gen_random_uuid(), date '2026-11-01', 'off', true);
    raise exception 'FAIL: anon が内部関数を呼べた';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok: 直接アクセスの禁止';
end $$;

-- 間違った URL
do $$ begin
  begin
    perform public.get_bootstrap('wrong');
    raise exception 'FAIL: 間違ったトークンで読めた';
  exception when sqlstate 'P0001' then null;
  end;
  raise notice 'ok: URL のトークン確認';
end $$;

-- 管理者ログイン（失敗 → 成功）
do $$
declare r jsonb; s text;
begin
  r := public.admin_login(current_setting('t.token'), '0000');
  assert (r->>'ok')::boolean = false, 'FAIL: 間違ったパスコードで入れた';
  r := public.admin_login(current_setting('t.token'), '1234');
  assert (r->>'ok')::boolean, 'FAIL: 正しいパスコードで入れない';
  s := r->>'session';
  perform set_config('t.admin', s, false);
  assert public.admin_check(s), 'FAIL: admin_check';
  begin
    perform public.admin_get_overview('wrong-session');
    raise exception 'FAIL: セッションなしで管理者の関数を呼べた';
  exception when sqlstate 'P0001' then null;
  end;
  raise notice 'ok: 管理者ログイン';
end $$;

-- 名簿と月を用意
do $$
declare a text := current_setting('t.admin'); i int; id uuid;
begin
  foreach i in array array[1,2,3,4,5] loop
    id := public.admin_save_staff(a, null, 'スタッフ' || i, 'STAFF ' || i);
    perform set_config('t.s' || i, id::text, false);
  end loop;
  perform public.admin_save_month(a, '2026-11', now() + interval '10 days');
  perform public.admin_save_month(a, '2026-12', now() - interval '1 day');  -- 締切済み
  raise notice 'ok: 名簿・月の設定';
end $$;

-- 希望休：月3日まで
do $$
declare t text := current_setting('t.token'); s1 uuid := current_setting('t.s1')::uuid;
begin
  perform public.staff_set_request(t, s1, '2026-11-01', 'off');
  perform public.staff_set_request(t, s1, '2026-11-02', 'off');
  perform public.staff_set_request(t, s1, '2026-11-03', 'off');
  begin
    perform public.staff_set_request(t, s1, '2026-11-04', 'off');
    raise exception 'FAIL: 4日目の希望休が登録できた';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '希望休は月3日まで%', 'FAIL: メッセージ: ' || sqlerrm;
  end;
  -- 同じ日を入れ直すのは数えない
  perform public.staff_set_request(t, s1, '2026-11-03', 'off');
  -- 希望有休は枠に数えない
  perform public.staff_set_request(t, s1, '2026-11-04', 'paid');
  raise notice 'ok: 月3日まで（希望有休は数えない）';
end $$;

-- 同じ日は2人まで
do $$
declare t text := current_setting('t.token');
begin
  perform public.staff_set_request(t, current_setting('t.s2')::uuid, '2026-11-01', 'off');
  begin
    perform public.staff_set_request(t, current_setting('t.s3')::uuid, '2026-11-01', 'off');
    raise exception 'FAIL: 3人目が登録できた';
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'この日はすでに2人%', 'FAIL: メッセージ: ' || sqlerrm;
  end;
  -- 希望有休は同日の人数に数えない
  perform public.staff_set_request(t, current_setting('t.s3')::uuid, '2026-11-01', 'paid');
  perform public.staff_set_request(t, current_setting('t.s4')::uuid, '2026-11-04', 'off');
  raise notice 'ok: 同日2人まで（希望有休は数えない）';
end $$;

-- 希望有休は要相談 → 管理者が確認済みにできる
do $$
declare t text := current_setting('t.token'); d jsonb; rid uuid;
begin
  d := public.get_month(t, '2026-11');
  select (x->>'id')::uuid into rid from jsonb_array_elements(d->'requests') x
   where x->>'kind' = 'paid' and x->>'staff_id' = current_setting('t.s1');
  assert (select x->>'status' from jsonb_array_elements(d->'requests') x where (x->>'id')::uuid = rid) = 'pending', 'FAIL: 要相談になっていない';
  perform public.admin_set_paid_status(current_setting('t.admin'), rid, true);
  d := public.get_month(t, '2026-11');
  assert (select x->>'status' from jsonb_array_elements(d->'requests') x where (x->>'id')::uuid = rid) = 'confirmed', 'FAIL: 確認済みにならない';
  -- 本人が同じ日を希望有休で入れ直しても確認済みのまま
  perform public.staff_set_request(t, current_setting('t.s1')::uuid, '2026-11-04', 'paid');
  d := public.get_month(t, '2026-11');
  assert (select x->>'status' from jsonb_array_elements(d->'requests') x where (x->>'id')::uuid = rid) = 'confirmed', 'FAIL: 入れ直しで要相談に戻った';
  raise notice 'ok: 希望有休の要相談・確認済み';
end $$;

-- 取消と、締切後の制御
do $$
declare t text := current_setting('t.token'); s1 uuid := current_setting('t.s1')::uuid;
begin
  perform public.staff_cancel_request(t, s1, '2026-11-03');
  perform public.staff_set_request(t, s1, '2026-11-05', 'off');
  begin
    perform public.staff_set_request(t, s1, '2026-12-01', 'off');
    raise exception 'FAIL: 締切後に登録できた';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.staff_save_note(t, s1, '2026-12-01', 'plan', '潮風会');
    raise exception 'FAIL: 締切後にコメントを書けた';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.staff_set_request(t, s1, '2027-01-05', 'off');
    raise exception 'FAIL: 未設定の月に登録できた';
  exception when sqlstate 'P0001' then null;
  end;
  raise notice 'ok: 取消・締切後は登録不可';
end $$;

-- 管理者の代行登録（上限超え・3人目・締切後）
do $$
declare a text := current_setting('t.admin'); r jsonb;
begin
  r := public.admin_set_request(a, current_setting('t.s3')::uuid, '2026-11-01', 'off');
  assert (r->>'is_exception')::boolean, 'FAIL: 3人目が例外扱いになっていない';
  r := public.admin_set_request(a, current_setting('t.s1')::uuid, '2026-11-06', 'off');
  assert (r->>'is_exception')::boolean, 'FAIL: 4日目が例外扱いになっていない';
  r := public.admin_set_request(a, current_setting('t.s1')::uuid, '2026-12-01', 'paid', true);
  assert (r->>'is_exception')::boolean and r->>'status' = 'confirmed', 'FAIL: 締切後の代行登録';
  r := public.admin_set_request(a, current_setting('t.s5')::uuid, '2026-11-20', 'off');
  assert not (r->>'is_exception')::boolean, 'FAIL: 通常の代行登録が例外になっている';
  perform public.admin_cancel_request(a, current_setting('t.s1')::uuid, '2026-12-01');
  raise notice 'ok: 管理者の代行登録';
end $$;

-- 長期有休（管理者だけが登録できる）
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  s5 uuid := current_setting('t.s5')::uuid; lid uuid;
begin
  if exists (select 1 from pg_proc where proname in ('staff_save_long_leave', 'staff_delete_long_leave')) then
    raise exception 'FAIL: スタッフ用の長期有休の関数が残っている';
  end if;
  lid := public.admin_save_long_leave(a, s5, null, '2026-11-10', '2026-11-25', '海外');
  begin
    perform public.staff_set_request(t, s5, '2026-11-02', 'off');
    raise exception 'FAIL: 長期有休の月に希望休が入った';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '長期有休が入っている%', 'FAIL: メッセージ: ' || sqlerrm;
  end;
  perform public.staff_set_request(t, s5, '2026-11-02', 'paid');  -- 希望有休は入れられる
  -- 管理者は締切済みの月にも登録・変更できる
  perform public.admin_save_long_leave(a, s5, null, '2026-12-10', '2026-12-12', '');
  perform public.admin_save_long_leave(a, s5, lid, '2026-11-11', '2026-11-25', '海外（変更）');
  assert jsonb_array_length(public.get_month(t, '2026-11')->'long_leaves') = 1, 'FAIL: 長期有休が見えない';
  assert jsonb_array_length(public.get_long_leaves(t)) = 2, 'FAIL: 長期有休の一覧';
  raise notice 'ok: 長期有休（管理者のみ）';
end $$;

-- 出勤時間希望・予定あり・月のメモ
do $$
declare t text := current_setting('t.token'); s2 uuid := current_setting('t.s2')::uuid; d jsonb;
begin
  perform public.staff_save_note(t, s2, '2026-11-12', 'shift', '泊まりNG');
  perform public.staff_save_note(t, s2, '2026-11-12', 'plan', '潮風会 18:00〜');
  perform public.staff_save_note(t, s2, '2026-11-12', 'shift', '泊まり明け希望');  -- 上書き
  perform public.staff_save_month_memo(t, s2, '2026-11', '後半は夜が多めでも大丈夫です');
  d := public.get_month(t, '2026-11');
  assert jsonb_array_length(d->'notes') = 2, 'FAIL: notes の件数';
  assert exists (select 1 from jsonb_array_elements(d->'notes') x where x->>'comment' = '泊まり明け希望'), 'FAIL: 上書き';
  assert jsonb_array_length(d->'memos') = 1, 'FAIL: 月のメモ';
  perform public.staff_save_note(t, s2, '2026-11-12', 'plan', '  ');  -- 空 → 削除
  d := public.get_month(t, '2026-11');
  assert jsonb_array_length(d->'notes') = 1, 'FAIL: 空のコメントで削除されない';
  raise notice 'ok: 出勤時間希望・予定あり・月のメモ';
end $$;

-- パスコード5回失敗でロック
do $$
declare r jsonb; i int;
begin
  for i in 1..5 loop
    r := public.admin_login(current_setting('t.token'), 'bad');
  end loop;
  assert (r->>'locked')::boolean, 'FAIL: 5回目でロックされない';
  begin
    perform public.admin_login(current_setting('t.token'), '1234');
    raise exception 'FAIL: ロック中に入れた';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%ロック中%', 'FAIL: メッセージ: ' || sqlerrm;
  end;
  raise notice 'ok: 5回失敗でロック';
end $$;

-- URL の再発行で古い URL が使えなくなる
do $$
declare nt text;
begin
  nt := public.admin_regenerate_token(current_setting('t.admin'));
  begin
    perform public.get_bootstrap(current_setting('t.token'));
    raise exception 'FAIL: 古い URL が使えた';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.get_bootstrap(nt);
  perform set_config('t.token', nt, false);
  raise notice 'ok: URL の再発行';
end $$;

-- 操作履歴が残る
do $$ begin
  assert jsonb_array_length(public.admin_get_audit(current_setting('t.admin'), 500)) > 20, 'FAIL: 操作履歴';
  raise notice 'ok: 操作履歴';
end $$;

reset role;
select set_config('t.done', 'yes', false);
