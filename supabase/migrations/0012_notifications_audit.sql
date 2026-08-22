-- =============================================================
-- 運用に必要な土台：通知・監査ログ・顧客の見積回答
--
--  1. notifications … 見積依頼／代理店割当／確定見積／お問い合わせ／承諾辞退 を関係者へ通知する。
--     アプリからの明示的な呼び出しではなくトリガーで作るので、経路が増えても取りこぼさない。
--     メール送信は別途（RESEND_API_KEY 未設定なら email_status='skipped' で画面通知だけ残る）。
--  2. audit_logs … 価格・公開状態・権限の変更を DB 側で記録する。総代理店も価格を触れるため。
--  3. respond_to_quote … 顧客が確定見積を承諾／辞退する。
-- =============================================================

-- ---------- 通知 ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  /** 宛先ユーザー。null = 本部（管理者全員）宛 */
  recipient_id uuid references public.profiles (id) on delete cascade,
  audience text not null check (audience in ('admin', 'dealer', 'customer')),
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  email_error text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_pending_idx on public.notifications (email_status, created_at) where email_status = 'pending';

alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()) or public.is_admin());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()) or public.is_admin())
  with check (recipient_id = auth.uid() or (recipient_id is null and public.is_admin()) or public.is_admin());

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

create or replace function public.notify(
  p_recipient uuid, p_audience text, p_kind text, p_title text, p_body text, p_link text
)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, audience, kind, title, body, link)
  values (p_recipient, p_audience, p_kind, p_title, p_body, p_link);
$$;

-- 見積の発行・割り当て・回答
create or replace function public.trg_quote_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.revision = 1 then
      perform public.notify(null, 'admin', 'quote_requested',
        '新しい見積依頼：' || new.quote_no,
        new.customer_name || ' 様から見積依頼が届きました。担当代理店を割り当ててください。',
        '/admin/quotes/' || new.id);
    else
      perform public.notify(new.user_id, 'customer', 'quote_revised',
        '確定見積が届きました：' || new.quote_no,
        '代理店が別途工事を確認し、第' || new.revision || '版の確定見積を発行しました。',
        '/mypage/quotes/' || new.id);
    end if;
    return new;
  end if;

  if new.dealer_id is distinct from old.dealer_id and new.dealer_id is not null then
    perform public.notify(new.dealer_id, 'dealer', 'quote_assigned',
      '見積が割り当てられました：' || new.quote_no,
      new.customer_name || ' 様の見積です。別途工事・フリー商品を入力して確定見積を発行してください。',
      '/admin/quotes/' || new.id);
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    perform public.notify(null, 'admin', 'quote_' || new.status,
      '見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
      new.customer_name || ' 様が回答しました。',
      '/admin/quotes/' || new.id);
    if new.dealer_id is not null then
      perform public.notify(new.dealer_id, 'dealer', 'quote_' || new.status,
        '担当見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
        new.customer_name || ' 様が回答しました。',
        '/admin/quotes/' || new.id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_quotes_notify_ins on public.quotes;
create trigger trg_quotes_notify_ins after insert on public.quotes for each row execute function public.trg_quote_notify();
drop trigger if exists trg_quotes_notify_upd on public.quotes;
create trigger trg_quotes_notify_upd after update on public.quotes for each row execute function public.trg_quote_notify();

-- お問い合わせ
create or replace function public.trg_contact_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(null, 'admin', 'contact_received',
    '新しいお問い合わせ：' || coalesce(new.topic, 'その他'),
    new.full_name || ' 様（' || new.email || '）',
    '/admin/contacts');
  return new;
end $$;
drop trigger if exists trg_contact_messages_notify on public.contact_messages;
create trigger trg_contact_messages_notify after insert on public.contact_messages for each row execute function public.trg_contact_notify();

-- ---------- 監査ログ ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity text not null,
  entity_id uuid,
  summary text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);

alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_admin on public.audit_logs;
create policy audit_logs_admin on public.audit_logs for select using (public.is_admin());
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id uuid, p_summary text, p_before jsonb, p_after jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, summary, before, after)
  values (auth.uid(), v_email, p_action, p_entity, p_entity_id, p_summary, p_before, p_after);
end $$;

-- 商品の価格・公開状態
create or replace function public.trg_audit_option()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('create', 'option', new.id, '商品を追加：' || new.name, null,
      jsonb_build_object('price', new.price, 'status', new.status));
    return new;
  end if;
  if new.price is distinct from old.price then
    perform public.write_audit('price', 'option', new.id,
      '価格を変更：' || new.name || '（' || old.price || ' → ' || new.price || ' 円）',
      jsonb_build_object('price', old.price), jsonb_build_object('price', new.price));
  end if;
  if new.status is distinct from old.status then
    perform public.write_audit('status', 'option', new.id,
      '公開状態を変更：' || new.name || '（' || old.status || ' → ' || new.status || '）',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_options_audit on public.options;
create trigger trg_options_audit after insert or update on public.options for each row execute function public.trg_audit_option();

-- 本体価格
create or replace function public.trg_audit_model()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.base_price is distinct from old.base_price then
    perform public.write_audit('price', 'base_model', new.id,
      '本体価格を変更：' || new.name || '（' || old.base_price || ' → ' || new.base_price || ' 円）',
      jsonb_build_object('base_price', old.base_price), jsonb_build_object('base_price', new.base_price));
  end if;
  if new.status is distinct from old.status then
    perform public.write_audit('status', 'base_model', new.id,
      '公開状態を変更：' || new.name || '（' || old.status || ' → ' || new.status || '）',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_base_models_audit on public.base_models;
create trigger trg_base_models_audit after update on public.base_models for each row execute function public.trg_audit_model();

-- 権限
create or replace function public.trg_audit_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role_code is distinct from old.role_code then
    perform public.write_audit('role', 'profile', new.id,
      '権限を変更：' || new.full_name || '（' || old.role_code || ' → ' || new.role_code || '）',
      jsonb_build_object('role_code', old.role_code), jsonb_build_object('role_code', new.role_code));
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit after update on public.profiles for each row execute function public.trg_audit_role();

-- ---------- 顧客による見積の承諾・辞退 ----------
create or replace function public.respond_to_quote(p_quote_id uuid, p_status text)
returns public.quotes language plpgsql security definer set search_path = public as $$
declare
  q public.quotes;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'VALIDATION: 回答が不正です' using errcode = 'P0001';
  end if;
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if q.user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if q.status <> 'issued' then
    raise exception 'LOCKED: この見積にはすでに回答済みです（または改訂されています）' using errcode = 'P0001';
  end if;
  update public.quotes set status = p_status where id = p_quote_id returning * into q;
  update public.configurations set status = 'closed' where id = q.configuration_id;
  return q;
end $$;

revoke all on function public.respond_to_quote(uuid, text) from public;
grant execute on function public.respond_to_quote(uuid, text) to authenticated;
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;
grant execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb) to service_role;
