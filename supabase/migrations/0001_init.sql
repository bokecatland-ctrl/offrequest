-- ============================================================
-- 希望休入力アプリ：テーブル・DB関数
--
-- 方針
--   * テーブルは画面（anon / authenticated）から直接読み書きできない。
--     RLS を有効にしてポリシーを作らず、さらに権限も外す。
--   * 画面からの読み書きは、すべて下の DB 関数（security definer）経由。
--   * ルール（月の上限日数・同日の上限人数・締切）の最終判定はここで行う。
--   * 登録は対象月ごとのロック付きトランザクションで行い、
--     同時に押されても先に処理された方だけが通る。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- テーブル
-- ------------------------------------------------------------

create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  max_days            int  not null default 3 check (max_days > 0),
  max_per_day         int  not null default 2 check (max_per_day > 0),
  off_symbol          text not null default '/',
  paid_symbol         text not null default '有休',
  admin_passcode_hash text,
  access_token        text not null,
  failed_attempts     int  not null default 0,
  locked_until        timestamptz
);

create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (length(trim(display_name)) > 0),
  shift_name    text not null default '',
  sort_order    int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.months (
  month      text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  deadline   timestamptz not null,
  created_at timestamptz not null default now()
);

-- kind: off = 希望休 / paid = 希望有休
-- status: 希望有休のみ。pending = 要相談 / confirmed = 確認済み
create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  month        text not null references public.months(month),
  date         date not null,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  kind         text not null check (kind in ('off', 'paid')),
  status       text check (status in ('pending', 'confirmed')),
  is_exception boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (staff_id, date),
  check ((kind = 'paid') = (status is not null)),
  check (to_char(date, 'YYYY-MM') = month)
);
create index if not exists requests_month_idx on public.requests (month, date);

create table if not exists public.long_leaves (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  memo       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- type: shift = 出勤時間希望 / plan = 予定あり
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  month      text not null references public.months(month),
  date       date not null,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  type       text not null check (type in ('shift', 'plan')),
  comment    text not null check (length(trim(comment)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date, type),
  check (to_char(date, 'YYYY-MM') = month)
);
create index if not exists notes_month_idx on public.notes (month, date);

create table if not exists public.month_memos (
  month      text not null references public.months(month),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  memo       text not null,
  updated_at timestamptz not null default now(),
  primary key (month, staff_id)
);

create table if not exists public.admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  actor    text not null,          -- staff / admin / system
  staff_id uuid,                   -- 対象スタッフ（削除後も残すため外部キーなし）
  action   text not null,
  detail   jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- 直接アクセスの禁止
alter table public.settings       enable row level security;
alter table public.staff          enable row level security;
alter table public.months         enable row level security;
alter table public.requests       enable row level security;
alter table public.long_leaves    enable row level security;
alter table public.notes          enable row level security;
alter table public.month_memos    enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.audit_log      enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ------------------------------------------------------------
-- 内部用の関数（画面からは呼べない）
-- ------------------------------------------------------------

create or replace function public._fail(p_message text, p_hint text default null)
returns void language plpgsql as $$
begin
  if p_hint is null then
    raise exception '%', p_message using errcode = 'P0001';
  else
    raise exception '%', p_message using errcode = 'P0001', hint = p_hint;
  end if;
end $$;

create or replace function public._month_of(p_date date)
returns text language sql immutable as $$
  select to_char(p_date, 'YYYY-MM')
$$;

create or replace function public._month_range(p_month text, out first_day date, out last_day date)
language sql immutable as $$
  select to_date(p_month || '-01', 'YYYY-MM-DD'),
         (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
$$;

create or replace function public._check_token(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is null or not exists (select 1 from settings where access_token = p_token) then
    perform _fail('このURLは使えません。管理者から新しいURLを受け取ってください。', 'invalid_token');
  end if;
end $$;

create or replace function public._check_admin(p_session text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_session is null or not exists (
    select 1 from admin_sessions
     where token_hash = encode(digest(p_session, 'sha256'), 'hex')
       and expires_at > now()
  ) then
    perform _fail('管理者モードの有効期限が切れました。もう一度パスコードを入力してください。', 'admin_session');
  end if;
end $$;

create or replace function public._check_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from staff where id = p_staff_id and active) then
    perform _fail('名前が見つかりません。名前を選び直してください。', 'invalid_staff');
  end if;
end $$;

-- 月が設定されているか確認し、締切日時を返す
create or replace function public._month_deadline(p_month text)
returns timestamptz language plpgsql security definer set search_path = public, extensions as $$
declare
  v_deadline timestamptz;
begin
  select deadline into v_deadline from months where month = p_month;
  if not found then
    perform _fail('この月はまだ受付していません。');
  end if;
  return v_deadline;
end $$;

create or replace function public._check_open(p_month text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if now() > _month_deadline(p_month) then
    perform _fail('締切を過ぎているため変更できません。変更は管理者に相談してください。', 'closed');
  end if;
end $$;

-- 期間に重なる月のうち、締切を過ぎた月があれば止める（スタッフの長期有休用）
create or replace function public._check_range_open(p_start date, p_end date)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (
    select 1 from months m
     where m.deadline < now()
       and (_month_range(m.month)).first_day <= p_end
       and (_month_range(m.month)).last_day  >= p_start
  ) then
    perform _fail('締切を過ぎた月を含むため変更できません。変更は管理者に相談してください。', 'closed');
  end if;
end $$;

create or replace function public._has_long_leave(p_staff_id uuid, p_month text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from long_leaves l
     where l.staff_id = p_staff_id
       and l.start_date <= (_month_range(p_month)).last_day
       and l.end_date   >= (_month_range(p_month)).first_day
  )
$$;

create or replace function public._audit(p_actor text, p_staff_id uuid, p_action text, p_detail jsonb)
returns void language sql security definer set search_path = public, extensions as $$
  insert into audit_log (actor, staff_id, action, detail) values (p_actor, p_staff_id, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public._lock_month(p_month text)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtext('offrequest:month:' || p_month))
$$;

-- 月のデータ（全員に見える内容）
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
      from month_memos m where m.month = p_month), '[]'::jsonb)
  );
end $$;

-- 希望休・希望有休の登録（スタッフ・管理者共通の本体）
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

create or replace function public._cancel_request(p_staff_id uuid, p_date date, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_month text := _month_of(p_date);
  v_row requests%rowtype;
begin
  perform _lock_month(v_month);
  if not p_is_admin then
    perform _check_open(v_month);
  end if;
  delete from requests where staff_id = p_staff_id and date = p_date returning * into v_row;
  if found then
    perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'cancel_request',
      jsonb_build_object('date', p_date, 'kind', v_row.kind, 'status', v_row.status));
  end if;
end $$;

create or replace function public._save_note(p_staff_id uuid, p_date date, p_type text, p_comment text, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_month text := _month_of(p_date);
  v_comment text := trim(coalesce(p_comment, ''));
begin
  if p_type not in ('shift', 'plan') then
    perform _fail('種類が正しくありません。');
  end if;
  if length(v_comment) > 500 then
    perform _fail('コメントは500文字以内で入力してください。');
  end if;
  if p_is_admin then
    perform _month_deadline(v_month);
  else
    perform _check_open(v_month);
  end if;

  if v_comment = '' then
    delete from notes where staff_id = p_staff_id and date = p_date and type = p_type;
    if found then
      perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'delete_note',
        jsonb_build_object('date', p_date, 'type', p_type));
    end if;
  else
    insert into notes (month, date, staff_id, type, comment)
    values (v_month, p_date, p_staff_id, p_type, v_comment)
    on conflict (staff_id, date, type) do update set comment = excluded.comment, updated_at = now();
    perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'save_note',
      jsonb_build_object('date', p_date, 'type', p_type, 'comment', v_comment));
  end if;
end $$;

create or replace function public._save_month_memo(p_staff_id uuid, p_month text, p_memo text, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_memo text := trim(coalesce(p_memo, ''));
begin
  if length(v_memo) > 1000 then
    perform _fail('メモは1000文字以内で入力してください。');
  end if;
  if p_is_admin then
    perform _month_deadline(p_month);
  else
    perform _check_open(p_month);
  end if;
  if v_memo = '' then
    delete from month_memos where month = p_month and staff_id = p_staff_id;
  else
    insert into month_memos (month, staff_id, memo) values (p_month, p_staff_id, v_memo)
    on conflict (month, staff_id) do update set memo = excluded.memo, updated_at = now();
  end if;
  perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'save_month_memo',
    jsonb_build_object('month', p_month, 'memo', v_memo));
end $$;

create or replace function public._save_long_leave(
  p_staff_id uuid, p_id uuid, p_start date, p_end date, p_memo text, p_is_admin boolean
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_old long_leaves%rowtype;
  v_id uuid;
begin
  if p_start is null or p_end is null then
    perform _fail('開始日と終了日を入力してください。');
  end if;
  if p_end < p_start then
    perform _fail('終了日は開始日より後の日付にしてください。');
  end if;
  if p_end - p_start > 366 then
    perform _fail('期間が長すぎます（1年以内）。');
  end if;
  if length(coalesce(p_memo, '')) > 500 then
    perform _fail('メモは500文字以内で入力してください。');
  end if;

  if p_id is not null then
    select * into v_old from long_leaves where id = p_id for update;
    if not found then
      perform _fail('長期有休が見つかりません。');
    end if;
    if not p_is_admin and v_old.staff_id <> p_staff_id then
      perform _fail('自分が入れた長期有休だけ変更できます。');
    end if;
    if not p_is_admin then
      perform _check_range_open(v_old.start_date, v_old.end_date);
    end if;
  end if;
  if not p_is_admin then
    perform _check_range_open(p_start, p_end);
  end if;

  if p_id is null then
    insert into long_leaves (staff_id, start_date, end_date, memo)
    values (p_staff_id, p_start, p_end, trim(coalesce(p_memo, '')))
    returning id into v_id;
  else
    update long_leaves
       set staff_id = case when p_is_admin then p_staff_id else staff_id end,
           start_date = p_start, end_date = p_end, memo = trim(coalesce(p_memo, '')), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;

  perform _audit(case when p_is_admin then 'admin' else 'staff' end, p_staff_id, 'save_long_leave',
    jsonb_build_object('id', v_id, 'start_date', p_start, 'end_date', p_end, 'memo', p_memo));
  return v_id;
end $$;

create or replace function public._delete_long_leave(p_staff_id uuid, p_id uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_old long_leaves%rowtype;
begin
  select * into v_old from long_leaves where id = p_id for update;
  if not found then
    return;
  end if;
  if not p_is_admin then
    if v_old.staff_id <> p_staff_id then
      perform _fail('自分が入れた長期有休だけ削除できます。');
    end if;
    perform _check_range_open(v_old.start_date, v_old.end_date);
  end if;
  delete from long_leaves where id = p_id;
  perform _audit(case when p_is_admin then 'admin' else 'staff' end, v_old.staff_id, 'delete_long_leave',
    jsonb_build_object('id', p_id, 'start_date', v_old.start_date, 'end_date', v_old.end_date));
end $$;

-- ------------------------------------------------------------
-- 初期設定（Supabase の SQL エディタから実行する。画面からは呼べない）
--   select public.setup_app('管理者パスコード');
--   戻り値がスタッフ用URLに付ける文字列。
--   パスコードを忘れたときも、同じ関数で設定し直せる（URLはそのまま）。
--   URLも作り直す場合は  select public.setup_app('パスコード', true);
-- ------------------------------------------------------------
create or replace function public.setup_app(p_passcode text, p_regenerate_token boolean default false)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  if p_passcode is null or length(p_passcode) < 4 then
    perform _fail('パスコードは4文字以上にしてください。');
  end if;
  insert into settings (id, access_token, admin_passcode_hash)
  values (1, encode(gen_random_bytes(16), 'hex'), crypt(p_passcode, gen_salt('bf')))
  on conflict (id) do update
     set admin_passcode_hash = excluded.admin_passcode_hash,
         access_token = case when p_regenerate_token then excluded.access_token else settings.access_token end,
         failed_attempts = 0,
         locked_until = null;
  delete from admin_sessions;
  select access_token into v_token from settings where id = 1;
  perform _audit('system', null, 'setup_app', jsonb_build_object('regenerate_token', p_regenerate_token));
  return v_token;
end $$;

-- ------------------------------------------------------------
-- スタッフ画面から呼ぶ関数
-- ------------------------------------------------------------

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
                          from months), '[]'::jsonb)
  );
end $$;

create or replace function public.get_month(p_token text, p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  return _month_data(p_month);
end $$;

create or replace function public.staff_set_request(p_token text, p_staff_id uuid, p_date date, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  return _set_request(p_staff_id, p_date, p_kind, false);
end $$;

create or replace function public.staff_cancel_request(p_token text, p_staff_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _cancel_request(p_staff_id, p_date, false);
end $$;

create or replace function public.staff_save_note(p_token text, p_staff_id uuid, p_date date, p_type text, p_comment text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _save_note(p_staff_id, p_date, p_type, p_comment, false);
end $$;

create or replace function public.staff_save_month_memo(p_token text, p_staff_id uuid, p_month text, p_memo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _save_month_memo(p_staff_id, p_month, p_memo, false);
end $$;

create or replace function public.staff_save_long_leave(
  p_token text, p_staff_id uuid, p_id uuid, p_start date, p_end date, p_memo text
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  return _save_long_leave(p_staff_id, p_id, p_start, p_end, p_memo, false);
end $$;

create or replace function public.staff_delete_long_leave(p_token text, p_staff_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _delete_long_leave(p_staff_id, p_id, false);
end $$;

-- 長期有休の一覧（全期間。今日より前に終わったものは除く）
create or replace function public.get_long_leaves(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'staff_id', l.staff_id, 'start_date', l.start_date, 'end_date', l.end_date, 'memo', l.memo
    ) order by l.start_date, l.created_at)
    from long_leaves l
    where l.end_date >= (now() at time zone 'Asia/Tokyo')::date - 31), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------
-- 管理者
-- ------------------------------------------------------------

create or replace function public.admin_login(p_token text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_settings settings%rowtype;
  v_session text;
  v_expires timestamptz := now() + interval '30 days';
begin
  perform _check_token(p_token);
  select * into v_settings from settings where id = 1 for update;

  if v_settings.admin_passcode_hash is null then
    perform _fail('パスコードが設定されていません。');
  end if;
  if v_settings.locked_until is not null and v_settings.locked_until > now() then
    perform _fail(format('パスコードを5回間違えたため、ロック中です。%s 以降にもう一度お試しください。',
      to_char(v_settings.locked_until at time zone 'Asia/Tokyo', 'HH24:MI')), 'locked');
  end if;

  if crypt(coalesce(p_passcode, ''), v_settings.admin_passcode_hash) <> v_settings.admin_passcode_hash then
    -- ここで例外を出すと更新が取り消されるため、失敗回数の記録は戻り値で返す
    update settings
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = 1
    returning * into v_settings;
    perform _audit('system', null, 'admin_login_failed', '{}'::jsonb);
    if v_settings.locked_until is not null then
      return jsonb_build_object('ok', false, 'message', 'パスコードを5回間違えたため、15分間ロックしました。', 'locked', true);
    end if;
    return jsonb_build_object('ok', false,
      'message', format('パスコードが違います（あと%s回でロック）。', 5 - v_settings.failed_attempts), 'locked', false);
  end if;

  update settings set failed_attempts = 0, locked_until = null where id = 1;
  delete from admin_sessions where expires_at < now();
  v_session := encode(gen_random_bytes(24), 'hex');
  insert into admin_sessions (token_hash, expires_at) values (encode(digest(v_session, 'sha256'), 'hex'), v_expires);
  perform _audit('admin', null, 'admin_login', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'session', v_session, 'expires_at', v_expires);
end $$;

create or replace function public.admin_logout(p_session text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from admin_sessions where token_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex')
$$;

create or replace function public.admin_check(p_session text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return p_session is not null and exists (
    select 1 from admin_sessions
     where token_hash = encode(digest(p_session, 'sha256'), 'hex') and expires_at > now());
end $$;

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
                          from months), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_get_month(p_session text, p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return _month_data(p_month);
end $$;

create or replace function public.admin_set_request(
  p_session text, p_staff_id uuid, p_date date, p_kind text, p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return _set_request(p_staff_id, p_date, p_kind, true, p_confirmed);
end $$;

create or replace function public.admin_cancel_request(p_session text, p_staff_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  perform _cancel_request(p_staff_id, p_date, true);
end $$;

create or replace function public.admin_set_paid_status(p_session text, p_request_id uuid, p_confirmed boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row requests%rowtype;
begin
  perform _check_admin(p_session);
  update requests
     set status = case when p_confirmed then 'confirmed' else 'pending' end, updated_at = now()
   where id = p_request_id and kind = 'paid'
  returning * into v_row;
  if not found then
    perform _fail('希望有休が見つかりません。');
  end if;
  perform _audit('admin', v_row.staff_id, 'set_paid_status', jsonb_build_object('date', v_row.date, 'status', v_row.status));
end $$;

create or replace function public.admin_save_note(p_session text, p_staff_id uuid, p_date date, p_type text, p_comment text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  perform _save_note(p_staff_id, p_date, p_type, p_comment, true);
end $$;

create or replace function public.admin_save_month_memo(p_session text, p_staff_id uuid, p_month text, p_memo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  perform _save_month_memo(p_staff_id, p_month, p_memo, true);
end $$;

create or replace function public.admin_save_long_leave(
  p_session text, p_staff_id uuid, p_id uuid, p_start date, p_end date, p_memo text
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return _save_long_leave(p_staff_id, p_id, p_start, p_end, p_memo, true);
end $$;

create or replace function public.admin_delete_long_leave(p_session text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  perform _delete_long_leave(null, p_id, true);
end $$;

create or replace function public.admin_get_long_leaves(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'staff_id', l.staff_id, 'start_date', l.start_date, 'end_date', l.end_date, 'memo', l.memo
    ) order by l.start_date, l.created_at)
    from long_leaves l
    where l.end_date >= (now() at time zone 'Asia/Tokyo')::date - 31), '[]'::jsonb);
end $$;

-- 月の設定（作成・締切の変更）
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
  insert into months (month, deadline) values (p_month, p_deadline)
  on conflict (month) do update set deadline = excluded.deadline;
  perform _audit('admin', null, 'save_month', jsonb_build_object('month', p_month, 'deadline', p_deadline));
end $$;

-- スタッフ名簿
create or replace function public.admin_save_staff(
  p_session text, p_id uuid, p_display_name text, p_shift_name text, p_active boolean default true
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  perform _check_admin(p_session);
  if length(trim(coalesce(p_display_name, ''))) = 0 then
    perform _fail('表示名を入力してください。');
  end if;
  if p_id is null then
    insert into staff (display_name, shift_name, sort_order, active)
    values (trim(p_display_name), trim(coalesce(p_shift_name, '')),
            coalesce((select max(sort_order) + 1 from staff), 1), coalesce(p_active, true))
    returning id into v_id;
  else
    update staff set display_name = trim(p_display_name), shift_name = trim(coalesce(p_shift_name, '')),
                     active = coalesce(p_active, active)
     where id = p_id returning id into v_id;
    if v_id is null then
      perform _fail('スタッフが見つかりません。');
    end if;
  end if;
  perform _audit('admin', v_id, 'save_staff',
    jsonb_build_object('display_name', p_display_name, 'shift_name', p_shift_name, 'active', p_active));
  return v_id;
end $$;

create or replace function public.admin_reorder_staff(p_session text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  update staff s set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id;
  perform _audit('admin', null, 'reorder_staff', jsonb_build_object('ids', to_jsonb(p_ids)));
end $$;

create or replace function public.admin_delete_staff(p_session text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text;
begin
  perform _check_admin(p_session);
  delete from staff where id = p_id returning display_name into v_name;
  if found then
    perform _audit('admin', p_id, 'delete_staff', jsonb_build_object('display_name', v_name));
  end if;
end $$;

create or replace function public.admin_save_settings(
  p_session text, p_max_days int, p_max_per_day int, p_off_symbol text, p_paid_symbol text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  if p_max_days is null or p_max_days < 1 or p_max_per_day is null or p_max_per_day < 1 then
    perform _fail('上限は1以上にしてください。');
  end if;
  if length(trim(coalesce(p_off_symbol, ''))) = 0 or length(trim(coalesce(p_paid_symbol, ''))) = 0 then
    perform _fail('記号を入力してください。');
  end if;
  update settings set max_days = p_max_days, max_per_day = p_max_per_day,
                      off_symbol = trim(p_off_symbol), paid_symbol = trim(p_paid_symbol)
   where id = 1;
  perform _audit('admin', null, 'save_settings', jsonb_build_object(
    'max_days', p_max_days, 'max_per_day', p_max_per_day, 'off_symbol', p_off_symbol, 'paid_symbol', p_paid_symbol));
end $$;

create or replace function public.admin_change_passcode(p_session text, p_current text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  perform _check_admin(p_session);
  select admin_passcode_hash into v_hash from settings where id = 1;
  if crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    perform _fail('今のパスコードが違います。');
  end if;
  if p_new is null or length(p_new) < 4 then
    perform _fail('新しいパスコードは4文字以上にしてください。');
  end if;
  update settings set admin_passcode_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  -- ほかの端末の管理者モードは解除する（この端末はそのまま）
  delete from admin_sessions where token_hash <> encode(digest(p_session, 'sha256'), 'hex');
  perform _audit('admin', null, 'change_passcode', '{}'::jsonb);
end $$;

create or replace function public.admin_regenerate_token(p_session text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text := encode(gen_random_bytes(16), 'hex');
begin
  perform _check_admin(p_session);
  update settings set access_token = v_token where id = 1;
  perform _audit('admin', null, 'regenerate_token', '{}'::jsonb);
  return v_token;
end $$;

create or replace function public.admin_get_audit(p_session text, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'at', a.at, 'actor', a.actor, 'staff_id', a.staff_id,
      'staff_name', s.display_name, 'action', a.action, 'detail', a.detail
    ) order by a.at desc, a.id desc)
    from (select * from audit_log order by at desc, id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) a
    left join staff s on s.id = a.staff_id), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------
-- 実行権限：内部関数と初期設定は画面から呼べないようにする
-- ------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.get_bootstrap(text),
  public.get_month(text, text),
  public.get_long_leaves(text),
  public.staff_set_request(text, uuid, date, text),
  public.staff_cancel_request(text, uuid, date),
  public.staff_save_note(text, uuid, date, text, text),
  public.staff_save_month_memo(text, uuid, text, text),
  public.staff_save_long_leave(text, uuid, uuid, date, date, text),
  public.staff_delete_long_leave(text, uuid, uuid),
  public.admin_login(text, text),
  public.admin_logout(text),
  public.admin_check(text),
  public.admin_get_overview(text),
  public.admin_get_month(text, text),
  public.admin_set_request(text, uuid, date, text, boolean),
  public.admin_cancel_request(text, uuid, date),
  public.admin_set_paid_status(text, uuid, boolean),
  public.admin_save_note(text, uuid, date, text, text),
  public.admin_save_month_memo(text, uuid, text, text),
  public.admin_save_long_leave(text, uuid, uuid, date, date, text),
  public.admin_delete_long_leave(text, uuid),
  public.admin_get_long_leaves(text),
  public.admin_save_month(text, text, timestamptz),
  public.admin_save_staff(text, uuid, text, text, boolean),
  public.admin_reorder_staff(text, uuid[]),
  public.admin_delete_staff(text, uuid),
  public.admin_save_settings(text, int, int, text, text),
  public.admin_change_passcode(text, text, text),
  public.admin_regenerate_token(text),
  public.admin_get_audit(text, int)
to anon, authenticated;

-- 今後作る関数も、既定では画面から呼べないようにする
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
