-- A-3 の写しから戻す関数（archive_a3_20261104.restore_removed_rows）を、migration を適用するロール（postgres）で動かせるかの確認（読み取りだけ）。
-- 戻す間だけ DB の保護（トリガー）を外す設定（session_replication_role）は、Supabase では特権ロール（supautils の privileged_role）に
-- 許された設定だけ変えられる。postgres がその特権ロールに属し、許された設定に session_replication_role があるかを見る。データは読まない・変えない
-- （読み取りの接続は supabase_read_only_user なので、この接続では設定そのものは変えられない）。
-- 使い方：npx supabase db query --linked --read-only --output-format json -f scripts/db-rehearsal/preflight-a3-restore-role.sql
select pg_catalog.jsonb_build_object(
  'privileged_role', pg_catalog.current_setting('supautils.privileged_role', true),
  'postgres_is_privileged', coalesce(pg_catalog.pg_has_role('postgres', pg_catalog.current_setting('supautils.privileged_role', true), 'member'), false),
  'session_replication_role_allowed', 'session_replication_role' = any(
     pg_catalog.string_to_array(pg_catalog.replace(coalesce(pg_catalog.current_setting('supautils.privileged_role_allowed_configs', true), ''), ' ', ''), ',')),
  'checked_at', now()
) as result;
