-- ローカルの PostgreSQL で Supabase に近い状態を作る（テスト・開発用）
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase と同じく、既定ではテーブル権限が anon に付く状態を再現する
alter default privileges in schema public grant all on tables to anon, authenticated;
