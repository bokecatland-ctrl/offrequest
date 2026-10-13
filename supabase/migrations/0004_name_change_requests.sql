-- 名前の変更申請
--   スタッフは一度選んだ名前を自由に変えられない。間違えた場合は、正しい名前を選んで申請し、
--   管理者が承認すると、そのスマホの名前が切り替わる。
--   スマホの区別には、ブラウザに保存したランダムな端末ID（device_id）を使う。

create table if not exists public.name_change_requests (
  id            uuid primary key default gen_random_uuid(),
  device_id     text not null check (length(device_id) between 8 and 100),
  from_staff_id uuid references public.staff(id) on delete cascade,
  to_staff_id   uuid not null references public.staff(id) on delete cascade,
  -- pending = 承認待ち / approved = 承認（端末への反映待ち） / rejected = 却下（端末への通知待ち）
  -- done = 端末に反映・通知済み / canceled = 本人が取り消し
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'done', 'canceled')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
-- 1台のスマホにつき、承認待ちは1件まで
create unique index if not exists name_change_requests_one_pending
  on public.name_change_requests (device_id) where status = 'pending';

alter table public.name_change_requests enable row level security;
revoke all on public.name_change_requests from anon, authenticated;

-- 申請（承認待ちがあれば置き換える）
create or replace function public.staff_request_name_change(
  p_token text, p_device_id text, p_from_staff_id uuid, p_to_staff_id uuid
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_to_staff_id);
  if p_device_id is null or length(p_device_id) < 8 then
    perform _fail('このスマホを識別できませんでした。ページを開き直してください。');
  end if;
  if p_from_staff_id is not distinct from p_to_staff_id then
    perform _fail('今と同じ名前です。');
  end if;
  update name_change_requests set status = 'canceled', decided_at = now()
   where device_id = p_device_id and status = 'pending';
  insert into name_change_requests (device_id, from_staff_id, to_staff_id)
  values (p_device_id, p_from_staff_id, p_to_staff_id);
  perform _audit('staff', p_from_staff_id, 'request_name_change', jsonb_build_object('to_staff_id', p_to_staff_id));
end $$;

-- このスマホの申請の状況（承認待ち・承認済みで未反映・却下で未通知）
create or replace function public.staff_name_change_status(p_token text, p_device_id text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  return (
    select jsonb_build_object('id', id, 'status', status, 'from_staff_id', from_staff_id, 'to_staff_id', to_staff_id,
                              'created_at', created_at)
      from name_change_requests
     where device_id = p_device_id and status in ('pending', 'approved', 'rejected')
     order by created_at desc
     limit 1
  );
end $$;

-- 承認・却下をスマホに反映したら呼ぶ（以後は表示しない）
create or replace function public.staff_ack_name_change(p_token text, p_device_id text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  update name_change_requests set status = 'done'
   where id = p_id and device_id = p_device_id and status in ('approved', 'rejected');
end $$;

-- 本人が申請を取り消す
create or replace function public.staff_cancel_name_change(p_token text, p_device_id text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  update name_change_requests set status = 'canceled', decided_at = now()
   where id = p_id and device_id = p_device_id and status = 'pending';
end $$;

-- 管理者：承認・却下
create or replace function public.admin_decide_name_change(p_session text, p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row name_change_requests%rowtype;
begin
  perform _check_admin(p_session);
  update name_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_id and status = 'pending'
  returning * into v_row;
  if not found then
    perform _fail('この申請は取り消されたか、すでに処理されています。');
  end if;
  perform _audit('admin', v_row.from_staff_id,
    case when p_approve then 'approve_name_change' else 'reject_name_change' end,
    jsonb_build_object('to_staff_id', v_row.to_staff_id));
end $$;

-- 管理者の概要に、承認待ちの名前の変更申請を加える
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
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'deadline', deadline) order by month)
                          from months), '[]'::jsonb),
    'name_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'from_staff_id', from_staff_id, 'to_staff_id', to_staff_id, 'created_at', created_at
      ) order by created_at) from name_change_requests where status = 'pending'), '[]'::jsonb)
  );
end $$;

revoke execute on function
  public.staff_request_name_change(text, text, uuid, uuid),
  public.staff_name_change_status(text, text),
  public.staff_ack_name_change(text, text, uuid),
  public.staff_cancel_name_change(text, text, uuid),
  public.admin_decide_name_change(text, uuid, boolean)
from public;
grant execute on function
  public.staff_request_name_change(text, text, uuid, uuid),
  public.staff_name_change_status(text, text),
  public.staff_ack_name_change(text, text, uuid),
  public.staff_cancel_name_change(text, text, uuid),
  public.admin_decide_name_change(text, uuid, boolean)
to anon, authenticated;
