-- =============================================================
-- API ロール（anon / authenticated / service_role）への権限付与
-- Management API（supabase db query --linked）でマイグレーションを流すと
-- デフォルト権限が付かないため明示する。db push で適用した場合も無害。
-- =============================================================
-- Management API 経由で作成したため、API ロールへの権限付与を明示する
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- 採番テーブルと next_quote_no は関数経由のみ（直接アクセスは RLS ポリシー無しで拒否される）
revoke all on function public.next_quote_no() from anon, authenticated;
