-- 非破壊：既存データに通常分類を設定し、対応中の状態を許可する。
alter table public.contact_messages
  add column if not exists classification text not null default 'normal';
alter table public.contact_messages
  drop constraint if exists contact_messages_classification_check;
alter table public.contact_messages
  add constraint contact_messages_classification_check
  check (classification in ('normal', 'sales', 'spam'));
alter table public.contact_messages
  drop constraint if exists contact_messages_status_check;
alter table public.contact_messages
  add constraint contact_messages_status_check
  check (status in ('new', 'in_progress', 'handled'));
-- 管理者専用RLS/ACL・非公開Storageは変更しない。
