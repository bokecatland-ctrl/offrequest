-- 通知（Web プッシュ）
--   スマホごとの通知の登録（push_subscriptions）と、送る予定の通知（push_outbox）を持つ。
--   実際の送信は Vercel の関数（/api/push-dispatch）が行う。関数は合言葉（PUSH_KEYS の3つ目）で
--   push_claim を呼び、送る通知と宛先を受け取って送信する。
--   通知の鍵（公開鍵・合言葉）は、管理画面の「通知の設定」で作って保存する。

alter table public.settings add column if not exists vapid_public_key text;
alter table public.settings add column if not exists push_secret_hash text;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique check (endpoint ~ '^https://' and length(endpoint) < 1000),
  p256dh     text not null,
  auth       text not null,
  device_id  text,
  staff_id   uuid references public.staff(id) on delete set null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- target: all = スタッフ全員 / staff = その人 / admins = 管理者 / device = そのスマホ
create table if not exists public.push_outbox (
  id         bigserial primary key,
  target     text not null check (target in ('all', 'staff', 'admins', 'device')),
  staff_id   uuid,
  device_id  text,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists push_outbox_unsent on public.push_outbox (id) where sent_at is null;

-- 締切の通知を同じ月に二重に送らないための記録（d3 = 3日前 / d1 = 前日）
create table if not exists public.push_reminders_sent (
  month   text not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (month, kind)
);

alter table public.push_subscriptions  enable row level security;
alter table public.push_outbox         enable row level security;
alter table public.push_reminders_sent enable row level security;
revoke all on public.push_subscriptions, public.push_outbox, public.push_reminders_sent from anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from anon, authenticated;

-- 11/7（土）
create or replace function public._jp_date(p_date date)
returns text language sql immutable as $$
  select to_char(p_date, 'FMMM/FMDD') || '（' || (array['日','月','火','水','木','金','土'])[extract(dow from p_date)::int + 1] || '）'
$$;

-- 2026年12月
create or replace function public._month_label(p_month text)
returns text language sql immutable as $$
  select split_part(p_month, '-', 1) || '年' || split_part(p_month, '-', 2)::int || '月'
$$;

create or replace function public._push_enqueue(p_target text, p_staff_id uuid, p_device_id text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  -- 通知の鍵が未設定なら何もしない
  if (select vapid_public_key from settings where id = 1) is null then
    return;
  end if;
  insert into push_outbox (target, staff_id, device_id, title, body)
  values (p_target, p_staff_id, p_device_id, p_title, coalesce(p_body, ''));
end $$;

-- 締切3日前・前日の通知（まだ何も入れていない人だけ）。日本時間9時以降に、月ごとに1回だけ
create or replace function public._push_enqueue_reminders()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  r      months%rowtype;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_days int;
  v_kind text;
  v_first date;
  v_last  date;
begin
  if extract(hour from now() at time zone 'Asia/Tokyo') < 9 then
    return;
  end if;
  for r in select * from months where published and deadline > now() loop
    v_days := (r.deadline at time zone 'Asia/Tokyo')::date - v_today;
    v_kind := case v_days when 3 then 'd3' when 1 then 'd1' else null end;
    continue when v_kind is null;
    insert into push_reminders_sent (month, kind) values (r.month, v_kind) on conflict do nothing;
    continue when not found;
    select first_day, last_day into v_first, v_last from _month_range(r.month);
    insert into push_outbox (target, staff_id, title, body)
    select 'staff', s.id,
           case v_kind when 'd3' then '希望休の締切まであと3日です' else '希望休の締切は明日です' end,
           _month_label(r.month) || 'の希望休がまだ入っていません。締切は'
             || _jp_date((r.deadline at time zone 'Asia/Tokyo')::date) || 'です。'
      from staff s
     where s.active
       and not exists (select 1 from requests q where q.staff_id = s.id and q.month = r.month)
       and not exists (select 1 from notes n where n.staff_id = s.id and n.month = r.month)
       and not exists (select 1 from month_memos m where m.staff_id = s.id and m.month = r.month)
       and not exists (select 1 from long_leaves l where l.staff_id = s.id and l.start_date <= v_last and l.end_date >= v_first);
  end loop;
end $$;

create or replace function public._check_push_secret(p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  select push_secret_hash into v_hash from settings where id = 1;
  if v_hash is null or encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> v_hash then
    perform _fail('unauthorized');
  end if;
end $$;

-- 送信用（Vercel の関数から呼ぶ）：送る通知と宛先を受け取り、送信済みにする
create or replace function public.push_claim(p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_rows jsonb;
begin
  perform _check_push_secret(p_secret);
  perform _push_enqueue_reminders();
  with o as (
    update push_outbox set sent_at = now() where sent_at is null returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'title', o.title, 'body', o.body)), '[]'::jsonb)
    into v_rows
    from o
    join push_subscriptions s on (
         (o.target = 'all' and s.staff_id is not null)
      or (o.target = 'staff' and s.staff_id = o.staff_id)
      or (o.target = 'admins' and s.is_admin)
      or (o.target = 'device' and s.device_id = o.device_id));
  delete from push_outbox where sent_at < now() - interval '30 days';
  return v_rows;
end $$;

-- 送信用：届かなくなった宛先（スマホ側で通知をやめた等）を消す
create or replace function public.push_report(p_secret text, p_gone text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_push_secret(p_secret);
  delete from push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
end $$;

-- スタッフ：このスマホで通知を受け取る（名前と結びつける）
create or replace function public.staff_push_subscribe(
  p_token text, p_device_id text, p_staff_id uuid, p_endpoint text, p_p256dh text, p_auth text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  if p_staff_id is not null then
    perform _check_staff(p_staff_id);
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) >= 1000 then
    perform _fail('通知の登録に失敗しました。');
  end if;
  insert into push_subscriptions (endpoint, p256dh, auth, device_id, staff_id)
  values (p_endpoint, p_p256dh, p_auth, p_device_id, p_staff_id)
  on conflict (endpoint) do update
     set p256dh = excluded.p256dh, auth = excluded.auth, device_id = excluded.device_id,
         staff_id = excluded.staff_id, updated_at = now();
end $$;

-- 通知をやめる（スタッフ・管理者共通。URL の鍵で確認）
create or replace function public.push_unsubscribe(p_token text, p_endpoint text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_token(p_token);
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;

-- 管理者：この端末で管理者向けの通知を受け取る
create or replace function public.admin_push_subscribe(
  p_session text, p_device_id text, p_endpoint text, p_p256dh text, p_auth text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) >= 1000 then
    perform _fail('通知の登録に失敗しました。');
  end if;
  insert into push_subscriptions (endpoint, p256dh, auth, device_id, is_admin)
  values (p_endpoint, p_p256dh, p_auth, p_device_id, true)
  on conflict (endpoint) do update
     set p256dh = excluded.p256dh, auth = excluded.auth, device_id = excluded.device_id,
         is_admin = true, updated_at = now();
end $$;

-- 管理者：通知の鍵を保存（合言葉はハッシュだけ持つ）。鍵を変えると今までの登録は使えないので消す
create or replace function public.admin_set_push_keys(p_session text, p_public_key text, p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  if p_public_key !~ '^[A-Za-z0-9_-]{80,100}$' or length(coalesce(p_secret, '')) < 20 then
    perform _fail('通知の鍵の形式が正しくありません。');
  end if;
  update settings set vapid_public_key = p_public_key,
                      push_secret_hash = encode(digest(p_secret, 'sha256'), 'hex')
   where id = 1;
  delete from push_subscriptions;
  delete from push_outbox where sent_at is null;
  perform _audit('admin', null, 'set_push_keys', '{}'::jsonb);
end $$;

-- 管理者：通知の状況
create or replace function public.admin_push_status(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return jsonb_build_object(
    'configured', (select vapid_public_key is not null from settings where id = 1),
    'staff_devices', (select count(*) from push_subscriptions where staff_id is not null),
    'staff_people', (select count(distinct staff_id) from push_subscriptions where staff_id is not null),
    'admin_devices', (select count(*) from push_subscriptions where is_admin),
    'unsent', (select count(*) from push_outbox where sent_at is null)
  );
end $$;

-- 管理者：この端末にテスト通知
create or replace function public.admin_push_test(p_session text, p_device_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  perform _push_enqueue('device', null, p_device_id, 'テスト通知', '通知は正しく届いています。');
end $$;

-- 以下、通知を送るように既存の関数を置き換える（通知の行以外は前と同じ）

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
                          from months where published), '[]'::jsonb)
  );
end $$;

create or replace function public.staff_set_request(p_token text, p_staff_id uuid, p_date date, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_was_pending boolean;
  v_result jsonb;
begin
  perform _check_token(p_token);
  perform _check_staff(p_staff_id);
  perform _check_published(_month_of(p_date));
  select exists (select 1 from requests where staff_id = p_staff_id and date = p_date and kind = 'paid')
    into v_was_pending;
  v_result := _set_request(p_staff_id, p_date, p_kind, false);
  -- 新しく希望有休（要相談）が入ったら管理者に知らせる
  if p_kind = 'paid' and not v_was_pending then
    perform _push_enqueue('admins', null, null, '要相談の希望有休が入りました',
      (select display_name from staff where id = p_staff_id) || '：' || _jp_date(p_date));
  end if;
  return v_result;
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
  if p_confirmed then
    perform _push_enqueue('staff', v_row.staff_id, null, '希望有休が確認されました',
      _jp_date(v_row.date) || 'の希望有休が確認済みになりました。');
  end if;
  perform _audit('admin', v_row.staff_id, 'set_paid_status', jsonb_build_object('date', v_row.date, 'status', v_row.status));
end $$;

create or replace function public.admin_set_month_published(p_session text, p_month text, p_published boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  update months set published = p_published where month = p_month;
  if not found then
    perform _fail('月が見つかりません。');
  end if;
  if p_published then
    perform _push_enqueue('all', null, null,
      _month_label(p_month) || 'の希望休の受付を始めました',
      '締切は' || (select _jp_date((deadline at time zone 'Asia/Tokyo')::date) from months where month = p_month)
        || 'です。アプリを開いて入力してください。');
  end if;
  perform _audit('admin', null, case when p_published then 'publish_month' else 'unpublish_month' end,
    jsonb_build_object('month', p_month));
end $$;

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
  perform _push_enqueue('admins', null, null, '名前の変更申請が届きました',
    coalesce((select display_name from staff where id = p_from_staff_id), '（未選択）') || ' → '
      || (select display_name from staff where id = p_to_staff_id));
  perform _audit('staff', p_from_staff_id, 'request_name_change', jsonb_build_object('to_staff_id', p_to_staff_id));
end $$;

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
  if p_approve then
    perform _push_enqueue('device', null, v_row.device_id, '名前の変更が承認されました',
      '「' || (select display_name from staff where id = v_row.to_staff_id) || '」に切り替わります。アプリを開いてください。');
  else
    perform _push_enqueue('device', null, v_row.device_id, '名前の変更申請は承認されませんでした', '管理者に確認してください。');
  end if;
  perform _audit('admin', v_row.from_staff_id,
    case when p_approve then 'approve_name_change' else 'reject_name_change' end,
    jsonb_build_object('to_staff_id', v_row.to_staff_id));
end $$;

revoke execute on function
  public._jp_date(date), public._month_label(text),
  public._push_enqueue(text, uuid, text, text, text), public._push_enqueue_reminders(),
  public._check_push_secret(text)
from public, anon, authenticated;
revoke execute on function
  public.push_claim(text), public.push_report(text, text[]),
  public.staff_push_subscribe(text, text, uuid, text, text, text), public.push_unsubscribe(text, text),
  public.admin_push_subscribe(text, text, text, text, text), public.admin_set_push_keys(text, text, text),
  public.admin_push_status(text), public.admin_push_test(text, text)
from public;
grant execute on function
  public.push_claim(text), public.push_report(text, text[]),
  public.staff_push_subscribe(text, text, uuid, text, text, text), public.push_unsubscribe(text, text),
  public.admin_push_subscribe(text, text, text, text, text), public.admin_set_push_keys(text, text, text),
  public.admin_push_status(text), public.admin_push_test(text, text)
to anon, authenticated;
