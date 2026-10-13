-- 長期有休を登録・変更したら、その人の希望を自動で外す
--   * 長期有休がかかる月の「希望休」は全部外す（長期有休の月は希望休なし、のルールに合わせる）
--   * 長期有休の期間中の「希望有休」も外す（期間外の希望有休は残す）
-- 外した内容は操作履歴に残し、画面には件数を返す。
-- 長期有休は管理者だけが登録するため（0002）、内部関数も管理者用にまとめ直す。

drop function if exists public.admin_save_long_leave(text, uuid, uuid, date, date, text);
drop function if exists public._save_long_leave(uuid, uuid, date, date, text, boolean);

create or replace function public._save_long_leave(
  p_staff_id uuid, p_id uuid, p_start date, p_end date, p_memo text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_month text;
  v_removed jsonb;
begin
  if p_staff_id is null or not exists (select 1 from staff where id = p_staff_id) then
    perform _fail('名前を選んでください。');
  end if;
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

  -- 希望休の登録（_set_request）と同じ順番で月をロックし、同時に登録されても食い違わないようにする
  for v_month in
    select to_char(m, 'YYYY-MM')
      from generate_series(date_trunc('month', p_start), date_trunc('month', p_end), interval '1 month') m
     order by 1
  loop
    perform _lock_month(v_month);
  end loop;

  if p_id is null then
    insert into long_leaves (staff_id, start_date, end_date, memo)
    values (p_staff_id, p_start, p_end, trim(coalesce(p_memo, '')))
    returning id into v_id;
  else
    update long_leaves
       set staff_id = p_staff_id, start_date = p_start, end_date = p_end,
           memo = trim(coalesce(p_memo, '')), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      perform _fail('長期有休が見つかりません。');
    end if;
  end if;

  with removed as (
    delete from requests r
     where r.staff_id = p_staff_id
       and (
         (r.kind = 'off'
           and r.date >= date_trunc('month', p_start)::date
           and r.date <  (date_trunc('month', p_end) + interval '1 month')::date)
         or (r.kind = 'paid' and r.date between p_start and p_end)
       )
    returning r.date, r.kind, r.status
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', date, 'kind', kind, 'status', status) order by date), '[]'::jsonb)
    into v_removed from removed;

  perform _audit('admin', p_staff_id, 'save_long_leave',
    jsonb_build_object('id', v_id, 'start_date', p_start, 'end_date', p_end, 'memo', p_memo));
  if jsonb_array_length(v_removed) > 0 then
    perform _audit('admin', p_staff_id, 'auto_cancel_request',
      jsonb_build_object('start_date', p_start, 'end_date', p_end, 'removed', v_removed));
  end if;

  return jsonb_build_object('id', v_id, 'removed', v_removed);
end $$;

create or replace function public.admin_save_long_leave(
  p_session text, p_staff_id uuid, p_id uuid, p_start date, p_end date, p_memo text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_session);
  return _save_long_leave(p_staff_id, p_id, p_start, p_end, p_memo);
end $$;

revoke execute on function public._save_long_leave(uuid, uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.admin_save_long_leave(text, uuid, uuid, date, date, text) from public;
grant execute on function public.admin_save_long_leave(text, uuid, uuid, date, date, text) to anon, authenticated;
