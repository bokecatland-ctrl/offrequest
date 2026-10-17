-- 古い月をスタッフの画面から自動で隠す
--   対象月が終わってから1か月たったら、スタッフには見えなくする（例：11月は12/31まで、1/1から隠れる）。
--   データは消さない。管理者は引き続きすべての月を見られる。

-- スタッフに見せる月か（公開中で、対象月が終わってから1か月以内）
create or replace function public._month_visible(p_month text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from months
     where month = p_month
       and published
       and (now() at time zone 'Asia/Tokyo')::date < (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '2 months')::date
  )
$$;

-- スタッフの読み書きは、見せる月だけ（0006 の判定に「1か月たったら隠す」を加える）
create or replace function public._check_published(p_month text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _month_visible(p_month) then
    perform _fail('この月はまだ受付していないか、表示期間が終わっています。');
  end if;
end $$;

-- スタッフに返す月の一覧（ほかは 0007 と同じ）
create or replace function public.get_bootstrap(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  return jsonb_build_object(
    'now', now(),
    'settings', (select jsonb_build_object('max_days', max_days, 'max_per_day', max_per_day,
                                           'push_public_key', vapid_public_key) from settings where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by sort_order, created_at)
                         from staff where active), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'deadline', deadline) order by month)
                          from months where _month_visible(month)), '[]'::jsonb)
  );
end $$;

revoke execute on function public._month_visible(text) from public, anon, authenticated;
