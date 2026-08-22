-- =============================================================
-- お問い合わせの保存（トップページ／お問い合わせページのフォーム）
--   - 送信は service role（サーバー側）で行う。匿名ユーザーからの直接 INSERT は禁止。
--   - 閲覧は管理者のみ。
--   - 添付ファイルは非公開バケット contact-attachments に保存する。
-- =============================================================

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  topic text not null,
  message text not null,
  attachment_path text,
  attachment_name text,
  status text not null default 'new' check (status in ('new', 'handled')),
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
drop policy if exists contact_messages_admin_select on public.contact_messages;
create policy contact_messages_admin_select on public.contact_messages for select using (public.is_admin());
drop policy if exists contact_messages_admin_update on public.contact_messages;
create policy contact_messages_admin_update on public.contact_messages for update using (public.is_admin()) with check (public.is_admin());
-- INSERT ポリシーなし = service role のみ

grant select, update on public.contact_messages to authenticated;
grant all on public.contact_messages to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-attachments', 'contact-attachments', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf'])
on conflict (id) do nothing;
-- ポリシーなし = service role のみ読み書き
