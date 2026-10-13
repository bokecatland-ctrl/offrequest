-- 長期有休は管理者だけが登録・変更・削除する（年単位の希望を別で集め、管理者が入力するため）
-- スタッフ用の登録・削除の関数をなくす。閲覧（get_month / get_long_leaves）はそのまま全員できる。
drop function if exists public.staff_save_long_leave(text, uuid, uuid, date, date, text);
drop function if exists public.staff_delete_long_leave(text, uuid, uuid);
