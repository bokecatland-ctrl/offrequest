-- ローカル確認用のデモデータ（本番では使わない）
--   パスコード 1234 / スタッフ用URL のトークンは最後に表示される
\set ON_ERROR_STOP 1
select public.setup_app('1234') as token \gset
update public.settings set access_token = 'demo0123456789abcdef0123456789ab';

insert into public.staff (display_name, shift_name, sort_order) values
  ('高橋', 'TAKAHASHI', 1), ('渡辺', 'WATANABE', 2), ('中村', 'NAKAMURA', 3), ('鈴木', 'SUZUKI', 4),
  ('山田', 'YAMADA', 5), ('佐藤', 'SATO', 6), ('タイタノ', 'TAITANO', 7), ('伊藤', 'ITO', 8),
  ('アレクサンダー・ジョンソン＝ウィリアムズ', '', 9);

insert into public.months (month, deadline) values
  ('2026-11', '2026-10-25T23:59:00+09:00'),
  ('2026-10', '2026-09-25T23:59:00+09:00');

-- 締切前の 11 月：スタッフとして登録（ルールを通す）
do $$
declare t text := 'demo0123456789abcdef0123456789ab';
  s record;
begin
  for s in select id, display_name from public.staff loop
    perform set_config('demo.' || s.display_name, s.id::text, false);
  end loop;
  perform public.staff_set_request(t, current_setting('demo.山田')::uuid, '2026-11-03', 'off');
  perform public.staff_set_request(t, current_setting('demo.佐藤')::uuid, '2026-11-03', 'off');
  perform public.staff_set_request(t, current_setting('demo.タイタノ')::uuid, '2026-11-12', 'off');
  perform public.staff_set_request(t, current_setting('demo.伊藤')::uuid, '2026-11-12', 'off');
  perform public.staff_set_request(t, current_setting('demo.佐藤')::uuid, '2026-11-24', 'off');
  perform public.staff_set_request(t, current_setting('demo.鈴木')::uuid, '2026-11-24', 'off');
  perform public.staff_set_request(t, current_setting('demo.高橋')::uuid, '2026-11-18', 'off');
  perform public.staff_set_request(t, current_setting('demo.山田')::uuid, '2026-11-14', 'off');
  perform public.staff_set_request(t, current_setting('demo.伊藤')::uuid, '2026-11-20', 'off');
  perform public.staff_set_request(t, current_setting('demo.タイタノ')::uuid, '2026-11-23', 'off');
  perform public.staff_set_request(t, current_setting('demo.アレクサンダー・ジョンソン＝ウィリアムズ')::uuid, '2026-11-28', 'off');
  perform public.staff_set_request(t, current_setting('demo.鈴木')::uuid, '2026-11-07', 'paid');
  perform public.staff_save_note(t, current_setting('demo.タイタノ')::uuid, '2026-11-12', 'shift', '泊まりNG');
  perform public.staff_save_note(t, current_setting('demo.山田')::uuid, '2026-11-20', 'plan', '潮風会 18:00〜');
  perform public.staff_save_note(t, current_setting('demo.佐藤')::uuid, '2026-11-25', 'shift', '泊まり明け希望');
  perform public.staff_save_note(t, current_setting('demo.佐藤')::uuid, '2026-11-27', 'plan', '個人のミーティング');
  perform public.staff_save_month_memo(t, current_setting('demo.山田')::uuid, '2026-11', '後半は夜が多めでも大丈夫です。');
end $$;
-- 長期有休は管理者が登録する（postgres で内部関数を直接使う）
do $$ begin
  perform public._save_long_leave((select id from public.staff where display_name = '中村'), null, '2026-11-02', '2026-11-17', '帰省', true);
end $$;

select 'staff URL: http://localhost:5173/#k=demo0123456789abcdef0123456789ab' as info;
