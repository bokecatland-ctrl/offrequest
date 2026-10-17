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
  -- 新しく作った月は非公開：スタッフには見えず、入力もできない
  assert jsonb_array_length(public.get_bootstrap(current_setting('t.token'))->'months') = 0, 'FAIL: 非公開の月が見えている';
  begin
    perform public.get_month(current_setting('t.token'), '2026-11');
    raise exception 'FAIL: 非公開の月を読めた';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.staff_set_request(current_setting('t.token'), current_setting('t.s1')::uuid, '2026-11-01', 'off');
    raise exception 'FAIL: 非公開の月に登録できた';
  exception when sqlstate 'P0001' then null;
  end;
  -- 管理者は非公開の月も見られ、長期有休などを準備できる
  perform public.admin_get_month(a, '2026-11');
  assert (select bool_and(not (x->>'published')::boolean) from jsonb_array_elements(public.admin_get_overview(a)->'months') x),
    'FAIL: 管理者に非公開と出ない';
  perform public.admin_set_month_published(a, '2026-11', true);
  perform public.admin_set_month_published(a, '2026-12', true);
  assert jsonb_array_length(public.get_bootstrap(current_setting('t.token'))->'months') = 2, 'FAIL: 公開した月が見えない';
  -- 締切を変えても公開のまま
  perform public.admin_save_month(a, '2026-11', now() + interval '10 days');
  assert jsonb_array_length(public.get_bootstrap(current_setting('t.token'))->'months') = 2, 'FAIL: 締切変更で非公開に戻った';
  raise notice 'ok: 名簿・月の設定（非公開→公開）';
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
  lid := (public.admin_save_long_leave(a, s5, null, '2026-11-10', '2026-11-25', '海外')->>'id')::uuid;
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

-- 長期有休を後から入れると、その月の希望休と期間中の希望有休が自動で外れる
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  s4 uuid := current_setting('t.s4')::uuid; r jsonb; d jsonb;
begin
  perform public.staff_set_request(t, s4, '2026-11-21', 'off');   -- 期間中の希望休
  perform public.staff_set_request(t, s4, '2026-11-22', 'paid');  -- 期間中の希望有休
  perform public.staff_set_request(t, s4, '2026-11-08', 'paid');  -- 期間外の希望有休（残る）
  -- 11/4 の希望休（期間外・同じ月）も外れる
  r := public.admin_save_long_leave(a, s4, null, '2026-11-20', '2026-11-23', '');
  assert jsonb_array_length(r->'removed') = 3, 'FAIL: 外れた件数 ' || (r->'removed')::text;
  d := public.get_month(t, '2026-11');
  assert not exists (select 1 from jsonb_array_elements(d->'requests') x
                      where x->>'staff_id' = s4::text and x->>'kind' = 'off'), 'FAIL: 希望休が残っている';
  assert exists (select 1 from jsonb_array_elements(d->'requests') x
                  where x->>'staff_id' = s4::text and x->>'date' = '2026-11-08'), 'FAIL: 期間外の希望有休が消えた';
  assert not exists (select 1 from jsonb_array_elements(d->'requests') x
                      where x->>'staff_id' = s4::text and x->>'date' = '2026-11-22'), 'FAIL: 期間中の希望有休が残っている';
  raise notice 'ok: 長期有休でその月の希望休・期間中の希望有休が外れる';
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

-- 名前の変更申請 → 承認・却下
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  s1 uuid := current_setting('t.s1')::uuid; s2 uuid := current_setting('t.s2')::uuid; st jsonb; o jsonb;
begin
  perform public.staff_request_name_change(t, 'device-aaaa-1', s1, s2);
  perform public.staff_request_name_change(t, 'device-aaaa-1', s1, s2);  -- 出し直しても承認待ちは1件
  st := public.staff_name_change_status(t, 'device-aaaa-1');
  assert st->>'status' = 'pending' and st->>'to_staff_id' = s2::text, 'FAIL: 申請の状況 ' || st::text;
  o := public.admin_get_overview(a);
  assert jsonb_array_length(o->'name_changes') = 1, 'FAIL: 管理者に申請が見えない';
  perform public.admin_decide_name_change(a, (st->>'id')::uuid, true);
  st := public.staff_name_change_status(t, 'device-aaaa-1');
  assert st->>'status' = 'approved', 'FAIL: 承認になっていない';
  perform public.staff_ack_name_change(t, 'device-aaaa-1', (st->>'id')::uuid);
  assert public.staff_name_change_status(t, 'device-aaaa-1') is null, 'FAIL: 反映後も残っている';
  -- 却下
  perform public.staff_request_name_change(t, 'device-bbbb-2', s2, s1);
  st := public.staff_name_change_status(t, 'device-bbbb-2');
  perform public.admin_decide_name_change(a, (st->>'id')::uuid, false);
  assert public.staff_name_change_status(t, 'device-bbbb-2')->>'status' = 'rejected', 'FAIL: 却下';
  -- 取り消し
  perform public.staff_request_name_change(t, 'device-cccc-3', s1, s2);
  st := public.staff_name_change_status(t, 'device-cccc-3');
  perform public.staff_cancel_name_change(t, 'device-cccc-3', (st->>'id')::uuid);
  assert public.staff_name_change_status(t, 'device-cccc-3') is null, 'FAIL: 取り消し';
  begin
    perform public.admin_decide_name_change(a, (st->>'id')::uuid, true);
    raise exception 'FAIL: 取り消した申請を承認できた';
  exception when sqlstate 'P0001' then null;
  end;
  raise notice 'ok: 名前の変更申請';
end $$;

-- 受付しない日
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  s1 uuid := current_setting('t.s1')::uuid; s2 uuid := current_setting('t.s2')::uuid;
  s3 uuid := current_setting('t.s3')::uuid; n int; r jsonb; l jsonb;
begin
  perform public.staff_set_request(t, s3, '2026-11-29', 'off');           -- 先に入っていた希望休
  n := public.admin_save_blocked_days(a, '2026-11-28', '2026-11-30', '年末年始');
  assert n = 3, 'FAIL: 登録件数 ' || n;
  begin
    perform public.staff_set_request(t, s2, '2026-11-28', 'off');
    raise exception 'FAIL: 受付しない日に希望休が入った';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '年末年始のため%', 'FAIL: メッセージ: ' || sqlerrm;
  end;
  begin
    perform public.staff_set_request(t, s2, '2026-11-28', 'paid');
    raise exception 'FAIL: 受付しない日に希望有休が入った';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.staff_save_note(t, s2, '2026-11-28', 'plan', '潮風会');  -- コメントは書ける
  -- 先に入っていた希望は残り、管理者の一覧に出る
  l := public.admin_get_blocked_days(a);
  assert (select jsonb_array_length(x->'requests') from jsonb_array_elements(l) x where x->>'date' = '2026-11-29') = 1,
    'FAIL: 受付しない日に入っている希望が見えない';
  assert jsonb_array_length(public.get_month(t, '2026-11')->'blocked_days') = 3, 'FAIL: 月のデータに出ない';
  -- 本人は取り消せる。管理者は例外として登録できる
  perform public.staff_cancel_request(t, s3, '2026-11-29');
  r := public.admin_set_request(a, s3, '2026-11-29', 'off');
  assert (r->>'is_exception')::boolean, 'FAIL: 代行登録が例外になっていない';
  perform public.admin_delete_blocked_days(a, array['2026-11-28'::date, '2026-11-29'::date, '2026-11-30'::date]);
  perform public.staff_set_request(t, s2, '2026-11-28', 'paid');          -- 解除すれば入れられる
  raise notice 'ok: 受付しない日';
end $$;

-- 通知（Web プッシュ）
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  s1 uuid := current_setting('t.s1')::uuid; s2 uuid := current_setting('t.s2')::uuid; c jsonb; rid uuid; n int;
  pub text := repeat('B', 87);
begin
  -- 鍵が未設定のあいだは何も溜まらない
  perform public.admin_set_month_published(a, '2026-11', true);
  begin
    perform public.push_claim('x');
    raise exception 'FAIL: 合言葉なしで push_claim できた';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.admin_set_push_keys(a, pub, 'secret-secret-secret-123');
  assert public.get_bootstrap(t)->'settings'->>'push_public_key' = pub, 'FAIL: 公開鍵がスタッフに届かない';
  perform public.staff_push_subscribe(t, 'device-s1', s1, 'https://push.example/s1', 'k1', 'a1');
  perform public.staff_push_subscribe(t, 'device-s2', s2, 'https://push.example/s2', 'k2', 'a2');
  perform public.admin_push_subscribe(a, 'device-admin', 'https://push.example/admin', 'k3', 'a3');
  begin
    perform public.push_claim('wrong-secret');
    raise exception 'FAIL: 違う合言葉で push_claim できた';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.push_claim('secret-secret-secret-123');  -- 締切通知などを空にしておく

  -- 公開 → スタッフ全員（管理者だけの端末には送らない）
  perform public.admin_set_month_published(a, '2026-11', true);
  c := public.push_claim('secret-secret-secret-123');
  assert jsonb_array_length(c) = 2, 'FAIL: 公開の通知の宛先 ' || c::text;
  assert c->0->>'title' like '2026年11月の希望休の受付を始めました', 'FAIL: 公開の通知の文 ' || c::text;
  assert jsonb_array_length(public.push_claim('secret-secret-secret-123')) = 0, 'FAIL: 二重に送られる';

  -- 要相談の希望有休 → 管理者。確認済み → 本人
  perform public.staff_set_request(t, s2, '2026-11-26', 'paid');
  c := public.push_claim('secret-secret-secret-123');
  assert jsonb_array_length(c) = 1 and c->0->>'endpoint' = 'https://push.example/admin', 'FAIL: 要相談の通知 ' || c::text;
  select (x->>'id')::uuid into rid from jsonb_array_elements(public.get_month(t, '2026-11')->'requests') x
   where x->>'staff_id' = s2::text and x->>'date' = '2026-11-26';
  perform public.admin_set_paid_status(a, rid, true);
  c := public.push_claim('secret-secret-secret-123');
  assert jsonb_array_length(c) = 1 and c->0->>'endpoint' = 'https://push.example/s2', 'FAIL: 確認済みの通知 ' || c::text;
  assert c->0->>'body' = '11/26（木）の希望有休が確認済みになりました。', 'FAIL: 確認済みの文 ' || c::text;

  -- 名前の変更申請 → 管理者。承認 → そのスマホ
  perform public.staff_request_name_change(t, 'device-s1', s1, s2);
  c := public.push_claim('secret-secret-secret-123');
  assert jsonb_array_length(c) = 1 and c->0->>'endpoint' = 'https://push.example/admin', 'FAIL: 申請の通知 ' || c::text;
  perform public.admin_decide_name_change(a, (public.staff_name_change_status(t, 'device-s1')->>'id')::uuid, true);
  c := public.push_claim('secret-secret-secret-123');
  assert jsonb_array_length(c) = 1 and c->0->>'endpoint' = 'https://push.example/s1', 'FAIL: 承認の通知 ' || c::text;

  -- 届かなくなった宛先は消える
  perform public.push_report('secret-secret-secret-123', array['https://push.example/s2']);
  select (public.admin_push_status(a)->>'staff_devices')::int into n;
  assert n = 1, 'FAIL: 届かない宛先が消えていない';
  perform public.push_unsubscribe(t, 'https://push.example/s1');
  raise notice 'ok: 通知（公開・要相談・確認済み・名前の変更）';
end $$;

-- 締切の通知（まだ何も入れていない人だけ・1回だけ）
reset role;
do $$ begin
  insert into public.months (month, deadline, published)
  values ('2027-02', (((now() at time zone 'Asia/Tokyo')::date + 3) + time '23:59') at time zone 'Asia/Tokyo', true);
end $$;
set role anon;
do $$
declare a text := current_setting('t.admin'); s1 uuid := current_setting('t.s1')::uuid; c jsonb; n int;
begin
  perform public.staff_push_subscribe(current_setting('t.token'), 'device-s1', s1, 'https://push.example/s1b', 'k', 'a');
  c := public.push_claim('secret-secret-secret-123');
  if extract(hour from now() at time zone 'Asia/Tokyo') >= 9 then
    select count(*) into n from jsonb_array_elements(c) x where x->>'title' = '希望休の締切まであと3日です';
    assert n = 1, 'FAIL: 締切3日前の通知 ' || c::text;
    c := public.push_claim('secret-secret-secret-123');
    assert jsonb_array_length(c) = 0, 'FAIL: 締切の通知が二重に出た';
    raise notice 'ok: 締切3日前の通知';
  else
    raise notice 'skip: 締切の通知（日本時間9時前のため）';
  end if;
end $$;

-- 古い月は、対象月が終わってから1か月たつとスタッフに見えない（管理者には見える）
reset role;
insert into public.months (month, deadline, published) values
  (to_char((now() at time zone 'Asia/Tokyo') - interval '2 months', 'YYYY-MM'), now() - interval '80 days', true),
  (to_char((now() at time zone 'Asia/Tokyo') - interval '1 month', 'YYYY-MM'), now() - interval '50 days', true)
on conflict (month) do update set published = true;
set role anon;
do $$
declare t text := current_setting('t.token'); a text := current_setting('t.admin');
  old_m text := to_char((now() at time zone 'Asia/Tokyo') - interval '2 months', 'YYYY-MM');
  prev_m text := to_char((now() at time zone 'Asia/Tokyo') - interval '1 month', 'YYYY-MM');
begin
  assert not exists (select 1 from jsonb_array_elements(public.get_bootstrap(t)->'months') x where x->>'month' = old_m),
    'FAIL: 2か月前の月がスタッフに見えている';
  assert exists (select 1 from jsonb_array_elements(public.get_bootstrap(t)->'months') x where x->>'month' = prev_m),
    'FAIL: 先月がスタッフに見えない';
  begin
    perform public.get_month(t, old_m);
    raise exception 'FAIL: 隠れた月を読めた';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.admin_get_month(a, old_m);
  assert exists (select 1 from jsonb_array_elements(public.admin_get_overview(a)->'months') x where x->>'month' = old_m),
    'FAIL: 管理者に古い月が見えない';
  raise notice 'ok: 古い月を自動で隠す';
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
