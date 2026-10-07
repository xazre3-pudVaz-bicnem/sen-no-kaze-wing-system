-- ローカル実 DB リハーサル用：本番 Supabase（PostgreSQL 17.6）と同じ前提を素の PostgreSQL に再現する。
-- 2026-10-07 に本番のカタログ（ロール属性／所属／既定 ACL／スキーマ ACL／auth・storage の定義）を読み取って合わせた。
-- 実行者：supabase_admin（スーパーユーザー）。Supabase のローカル環境（docker）では不要。

-- ---------- ロール ----------
create role postgres login password 'postgres' nosuperuser createdb createrole replication bypassrls;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password 'authenticator';
create role dashboard_user nologin createrole replication;
create role supabase_auth_admin login noinherit createrole password 'x';
create role supabase_storage_admin login noinherit createrole password 'x';
create role supabase_privileged_role nologin;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role, authenticator to postgres with admin option;
grant supabase_privileged_role to postgres;
grant authenticator to supabase_storage_admin;

alter role postgres set search_path = "$user", public, extensions;
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';
alter role supabase_auth_admin set search_path = auth;
alter role supabase_storage_admin set search_path = storage;

alter database postgres owner to postgres;
alter database postgres set "app.settings.jwt_exp" = '3600';

-- ---------- スキーマ ----------
-- public：owner は pg_database_owner（＝postgres）。ACL は本番と同じ。
grant usage on schema public to postgres, anon, authenticated, service_role;

create schema extensions authorization postgres;
grant usage on schema extensions to anon, authenticated, service_role;
grant all on schema extensions to dashboard_user;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create schema auth authorization supabase_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant all on schema auth to supabase_auth_admin, dashboard_user;

create schema storage authorization supabase_admin;
grant usage on schema storage to postgres with grant option;
grant usage on schema storage to anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin with grant option;
grant all on schema storage to dashboard_user;

create schema supabase_migrations authorization postgres;
create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
alter table supabase_migrations.schema_migrations owner to postgres;

-- ---------- auth ----------
create table auth.users (
  instance_id uuid,
  id uuid not null primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text default null::varchar unique,
  phone_confirmed_at timestamptz,
  phone_change text default ''::varchar,
  phone_change_token varchar(255) default ''::varchar,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default ''::varchar,
  email_change_confirm_status smallint default 0 check (email_change_confirm_status >= 0 and email_change_confirm_status <= 2),
  banned_until timestamptz,
  reauthentication_token varchar(255) default ''::varchar,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
alter table auth.users owner to supabase_auth_admin;
alter table auth.users enable row level security;
grant all on auth.users to dashboard_user;
grant insert, select, update, delete, truncate, references, trigger, maintain on auth.users to postgres;
grant select on auth.users to postgres with grant option;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;

-- ---------- storage ----------
create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
create table storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  type storage.buckettype not null default 'STANDARD',
  versioning_status text not null default 'DISABLED',
  lifecycle_configuration jsonb,
  lifecycle_configuration_generation uuid
);
create unique index bname on storage.buckets (name);
create table storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean not null default false,
  is_versioned boolean not null default false
);
create unique index bucketid_objname on storage.objects (bucket_id, name);
alter type storage.buckettype owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres with grant option;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;
create function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;
alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
alter function storage.extension(text) owner to supabase_storage_admin;

-- 本番では supautils の policy_grants により postgres が storage.objects / storage.buckets のポリシーを管理できる。
-- ローカルには supautils が無いので、所有ロールへの所属で同じ操作（create/drop policy）だけを可能にする。
grant supabase_storage_admin to postgres;

-- ---------- 既定権限（本番の pg_default_acl と同じ）----------
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on sequences to postgres, anon, authenticated, service_role;

-- ---------- RLS 自動有効化（本番に存在するイベントトリガー ensure_rls）----------
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end $$;
alter function public.rls_auto_enable() owner to postgres;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
alter event trigger ensure_rls owner to supabase_admin;
