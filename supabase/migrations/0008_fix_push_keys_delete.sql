-- 通知の鍵の保存で「通信に失敗しました」になる不具合の修正
--   Supabase は、画面から呼ばれた処理で条件なしの delete（全部消す）を禁止している（safeupdate）。
--   鍵を作り直したときに古い登録を全部消す delete に、明示的な条件を付ける。

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
  delete from push_subscriptions where true;
  delete from push_outbox where sent_at is null;
  perform _audit('admin', null, 'set_push_keys', '{}'::jsonb);
end $$;
