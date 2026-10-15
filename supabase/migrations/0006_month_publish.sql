-- 月の公開・非公開
--   新しく作った月は「非公開」。スタッフには見えず、入力もできない。
--   管理者はその間に長期有休・受付しない日などを整え、「公開する」でスタッフに開く。
--   すでにある月は公開のまま。

alter table public.months add column if not exists published boolean not null default true;

create or replace function public._check_published(p_month text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from months where month = p_month and published) then
    perform _fail('この月はまだ受付していません。');
  end if;
end $$;
revoke execute on function public._check_published(text) from public, anon, authenticated;

-- スタッフ：公開している月だけを返す
create or replace function public.get_bootstrap(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  return jsonb_build_object(
    'now', now(),
    'settings', (select jsonb_build_object('max_days', max_days, 'max_per_day', max_per_day) from settings where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by sort_order, created_at)
                         from staff where active), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'deadline', deadline) order by month)
                          from months where published), '[]'::jsonb)
  );
end $$;

-- スタッフ：非公開の月は読めない
create or replace function public.get_month(p_token text, p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_published(p_month);
  return _month_data(p_month);
end $$;

-- スタッフ：非公開の月には登録できない
create or replace function public.staff_set_request(p_token text, p_staff_id uuid, p_date date, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _check_published(_month_of(p_date));
  return _set_request(p_staff_id, p_date, p_kind, false);
end $$;

-- スタッフの取消・コメント・月のメモ：非公開の月はできない（管理者の代行は通る）
create or replace function public._check_open(p_month text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_published(p_month);
  if now() > _month_deadline(p_month) then
    perform _fail('締切を過ぎているため変更できません。変更は管理者に相談してください。', 'closed');
  end if;
end $$;

-- 管理者：月の作成（新しい月は非公開）・締切の変更
create or replace function public.admin_save_month(p_session text, p_month text, p_deadline timestamptz)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    perform _fail('対象月の形式が正しくありません。');
  end if;
  if p_deadline is null then
    perform _fail('締切日時を入力してください。');
  end if;
  -- 新しく作る月は非公開。公開はあとで admin_set_month_published で行う
  insert into months (month, deadline, published) values (p_month, p_deadline, false)
  on conflict (month) do update set deadline = excluded.deadline;
  perform _audit('admin', null, 'save_month', jsonb_build_object('month', p_month, 'deadline', p_deadline));
end $$;

-- 管理者：公開・非公開の切り替え
create or replace function public.admin_set_month_published(p_session text, p_month text, p_published boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  update months set published = p_published where month = p_month;
  if not found then
    perform _fail('月が見つかりません。');
  end if;
  perform _audit('admin', null, case when p_published then 'publish_month' else 'unpublish_month' end,
    jsonb_build_object('month', p_month));
end $$;

-- 管理者の概要：月に公開状態を加える（ほかは 0004 と同じ）
create or replace function public.admin_get_overview(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return jsonb_build_object(
    'now', now(),
    'settings', (select jsonb_build_object(
        'max_days', max_days, 'max_per_day', max_per_day,
        'off_symbol', off_symbol, 'paid_symbol', paid_symbol, 'access_token', access_token)
      from settings where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', display_name, 'shift_name', shift_name, 'sort_order', sort_order, 'active', active
      ) order by sort_order, created_at) from staff), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'deadline', deadline, 'published', published) order by month)
                          from months), '[]'::jsonb),
    'name_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'from_staff_id', from_staff_id, 'to_staff_id', to_staff_id, 'created_at', created_at
      ) order by created_at) from name_change_requests where status = 'pending'), '[]'::jsonb)
  );
end $$;

revoke execute on function public.admin_set_month_published(text, text, boolean) from public;
grant execute on function public.admin_set_month_published(text, text, boolean) to anon, authenticated;
