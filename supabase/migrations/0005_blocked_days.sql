-- 受付しない日（連休・年末年始など）
--   管理者が日付（期間）と理由を決める。その日は希望休・希望有休を受け付けない（コメントは書ける）。
--   すでに入っている希望は消さずに残し、管理画面で知らせる。管理者の代行登録は例外として通す。

create table if not exists public.blocked_days (
  date       date primary key,
  reason     text not null default '',
  created_at timestamptz not null default now()
);
alter table public.blocked_days enable row level security;
revoke all on public.blocked_days from anon, authenticated;

-- 希望休・希望有休の登録：受付しない日の判定を加える（ほかは 0001 と同じ）
create or replace function public._set_request(
  p_staff_id uuid, p_date date, p_kind text, p_is_admin boolean, p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_month    text := _month_of(p_date);
  v_settings settings%rowtype;
  v_closed   boolean;
  v_used     int;
  v_on_day   int;
  v_long     boolean;
  v_exc      boolean := false;
  v_status   text;
  v_row      requests%rowtype;
  v_reason   text;
begin
  if p_kind not in ('off', 'paid') then
    perform _fail('種類が正しくありません。');
  end if;
  if not exists (select 1 from staff where id = p_staff_id) then
    perform _fail('名前が見つかりません。');
  end if;

  -- 同じ月の登録は 1 件ずつ順番に処理する
  perform _lock_month(v_month);

  select * into v_settings from settings where id = 1;
  v_closed := now() > _month_deadline(v_month);

  if v_closed then
    if not p_is_admin then
      perform _fail('締切を過ぎているため変更できません。変更は管理者に相談してください。', 'closed');
    end if;
    v_exc := true;
  end if;

  -- 受付しない日（連休・年末年始など）。管理者の代行登録は例外として通す
  select reason into v_reason from blocked_days where date = p_date;
  if found then
    if not p_is_admin then
      perform _fail(
        case when v_reason <> '' then format('%sのため、', v_reason) else '' end
          || 'この日は希望休・希望有休を受け付けていません。', 'blocked');
    end if;
    v_exc := true;
  end if;

  if p_kind = 'off' then
    v_long := _has_long_leave(p_staff_id, v_month);
    select count(*) into v_used from requests
     where staff_id = p_staff_id and month = v_month and kind = 'off' and date <> p_date;
    select count(*) into v_on_day from requests
     where date = p_date and kind = 'off' and staff_id <> p_staff_id;

    if v_long then
      if not p_is_admin then
        perform _fail('長期有休が入っているため、この月の希望休は管理者に相談してください。', 'long_leave');
      end if;
      v_exc := true;
    end if;
    if v_used >= v_settings.max_days then
      if not p_is_admin then
        perform _fail(format('希望休は月%s日までです。ほかの日を取り消してから登録してください。', v_settings.max_days), 'max_days');
      end if;
      v_exc := true;
    end if;
    if v_on_day >= v_settings.max_per_day then
      if not p_is_admin then
        perform _fail(format('この日はすでに%s人入っているため登録できません。入っている人と相談してください。', v_settings.max_per_day), 'day_full');
      end if;
      v_exc := true;
    end if;
    v_status := null;
  else
    v_status := case when p_is_admin and p_confirmed then 'confirmed' else 'pending' end;
  end if;

  insert into requests (month, date, staff_id, kind, status, is_exception)
  values (v_month, p_date, p_staff_id, p_kind, v_status, v_exc)
  on conflict (staff_id, date) do update
     set kind = excluded.kind,
         -- 確認済みの希望有休を同じ種類で入れ直したときは、確認済みのまま
         status = case
                    when excluded.kind = 'paid' and requests.kind = 'paid' and not p_is_admin then requests.status
                    else excluded.status
                  end,
         is_exception = excluded.is_exception,
         updated_at = now()
  returning * into v_row;

  perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'set_request',
    jsonb_build_object('date', p_date, 'kind', p_kind, 'status', v_row.status, 'is_exception', v_exc));

  return jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'status', v_row.status, 'is_exception', v_row.is_exception);
end $$;

-- 月のデータ：受付しない日を加える（ほかは 0001 と同じ）
create or replace function public._month_data(p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_first date;
  v_last  date;
  v_deadline timestamptz;
begin
  v_deadline := _month_deadline(p_month);
  select first_day, last_day into v_first, v_last from _month_range(p_month);
  return jsonb_build_object(
    'month', p_month,
    'deadline', v_deadline,
    'now', now(),
    'is_closed', now() > v_deadline,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'date', r.date, 'staff_id', r.staff_id, 'kind', r.kind,
        'status', r.status, 'is_exception', r.is_exception, 'created_at', r.created_at
      ) order by r.date, r.created_at)
      from requests r where r.month = p_month), '[]'::jsonb),
    'long_leaves', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'staff_id', l.staff_id, 'start_date', l.start_date,
        'end_date', l.end_date, 'memo', l.memo
      ) order by l.start_date, l.created_at)
      from long_leaves l where l.start_date <= v_last and l.end_date >= v_first), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'date', n.date, 'staff_id', n.staff_id, 'type', n.type,
        'comment', n.comment
      ) order by n.date, n.created_at)
      from notes n where n.month = p_month), '[]'::jsonb),
    'memos', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'memo', m.memo, 'updated_at', m.updated_at)
        order by m.updated_at)
      from month_memos m where m.month = p_month), '[]'::jsonb),
    'blocked_days', coalesce((
      select jsonb_agg(jsonb_build_object('date', b.date, 'reason', b.reason) order by b.date)
      from blocked_days b where b.date between v_first and v_last), '[]'::jsonb)
  );
end $$;

-- 管理者：受付しない日を期間でまとめて登録（同じ日があれば理由を上書き）
create or replace function public.admin_save_blocked_days(p_session text, p_start date, p_end date, p_reason text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  v_count int;
begin
  perform _check_admin(p_session);
  if p_start is null or p_end is null or p_end < p_start then
    perform _fail('開始日と終了日を正しく入力してください。');
  end if;
  if p_end - p_start > 62 then
    perform _fail('一度に登録できるのは2か月以内です。');
  end if;
  if length(coalesce(p_reason, '')) > 50 then
    perform _fail('理由は50文字以内で入力してください。');
  end if;
  insert into blocked_days (date, reason)
  select d::date, trim(coalesce(p_reason, '')) from generate_series(p_start, p_end, interval '1 day') d
  on conflict (date) do update set reason = excluded.reason;
  get diagnostics v_count = row_count;
  perform _audit('admin', null, 'save_blocked_days',
    jsonb_build_object('start_date', p_start, 'end_date', p_end, 'reason', p_reason));
  return v_count;
end $$;

create or replace function public.admin_delete_blocked_days(p_session text, p_dates date[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  delete from blocked_days where date = any(p_dates);
  perform _audit('admin', null, 'delete_blocked_days', jsonb_build_object('dates', to_jsonb(p_dates)));
end $$;

-- 管理者：受付しない日の一覧（1か月前以降）と、そこに入っている希望
create or replace function public.admin_get_blocked_days(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', b.date, 'reason', b.reason,
      'requests', coalesce((select jsonb_agg(jsonb_build_object('staff_id', r.staff_id, 'kind', r.kind, 'status', r.status))
                              from requests r where r.date = b.date), '[]'::jsonb)
    ) order by b.date)
    from blocked_days b
    where b.date >= (now() at time zone 'Asia/Tokyo')::date - 31), '[]'::jsonb);
end $$;

revoke execute on function
  public.admin_save_blocked_days(text, date, date, text),
  public.admin_delete_blocked_days(text, date[]),
  public.admin_get_blocked_days(text)
from public;
grant execute on function
  public.admin_save_blocked_days(text, date, date, text),
  public.admin_delete_blocked_days(text, date[]),
  public.admin_get_blocked_days(text)
to anon, authenticated;
