-- =============================================================
-- Wing 見積シミュレーター  スキーマ
-- 第一段階（商品紹介＋2D画像式シミュレーター＋マイページ＋見積PDF＋管理画面）
-- 第二・第三段階（電子契約・図面承認・販売パートナー）は partner_id 等の拡張列と
-- 末尾のコメントにある予約テーブル名で追加できるようにしている。
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 共通 ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- 権限 ----------
create table public.roles (
  code text primary key,
  name text not null
);
insert into public.roles (code, name) values ('customer', '顧客'), ('admin', '管理者');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  company_name text,
  phone text,
  postal_code text,
  address text,
  role_code text not null default 'customer' references public.roles (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- auth.users 作成時に profiles を自動作成（メタデータから氏名等をコピー）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, company_name, phone, postal_code, address)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'company_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'postal_code', ''),
    nullif(new.raw_user_meta_data ->> 'address', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 現在のユーザーが管理者か（RLS から呼ぶ。security definer で profiles の再帰を避ける）
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_code = 'admin');
$$;

-- ---------- 商品マスター ----------
create table public.base_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  base_price integer not null check (base_price >= 0),
  status text not null default 'draft' check (status in ('published', 'draft')),
  sort_order integer not null default 0,
  specs jsonb not null default '[]'::jsonb,
  features jsonb not null default '[]'::jsonb,
  standard_equipment jsonb not null default '[]'::jsonb,
  use_cases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_base_models_updated before update on public.base_models for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models (id) on delete cascade,
  kind text not null check (kind in ('hero', 'exterior', 'interior', 'floorplan', 'transport', 'case')),
  url text not null,
  alt text not null default '',
  caption text,
  sort_order integer not null default 0
);
create index on public.product_images (base_model_id, kind, sort_order);

create table public.option_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  selection_mode text not null default 'multi' check (selection_mode in ('single', 'multi')),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  status text not null default 'published' check (status in ('published', 'draft'))
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid references public.base_models (id) on delete cascade, -- null = 全モデル共通
  category_id uuid not null references public.option_categories (id),
  code text not null unique,
  name text not null,
  description text,
  price integer not null default 0 check (price >= 0),
  image_url text,
  selection_type text not null default 'checkbox' check (selection_type in ('checkbox', 'radio')),
  is_required boolean not null default false,
  is_default boolean not null default false,
  is_installation boolean not null default false,
  price_on_request boolean not null default false,
  preview_key text,
  affects_views text[] not null default '{}',
  sort_order integer not null default 0,
  status text not null default 'published' check (status in ('published', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.options (category_id, sort_order);
create trigger trg_options_updated before update on public.options for each row execute function public.set_updated_at();

create table public.option_dependencies (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options (id) on delete cascade,
  requires_option_id uuid not null references public.options (id) on delete cascade,
  message text,
  unique (option_id, requires_option_id),
  check (option_id <> requires_option_id)
);

create table public.option_conflicts (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options (id) on delete cascade,
  conflicts_with_option_id uuid not null references public.options (id) on delete cascade,
  message text,
  unique (option_id, conflicts_with_option_id),
  check (option_id <> conflicts_with_option_id)
);

-- プレビュー画像ルール: view × キー集合 → 画像
create table public.preview_image_rules (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models (id) on delete cascade,
  view text not null check (view in ('exterior', 'interior', 'water', 'floorplan')),
  kind text not null default 'composite' check (kind in ('composite', 'layer')),
  preview_keys text[] not null default '{}',
  url text not null,
  alt text not null default '',
  note text,
  z_index integer not null default 0,
  status text not null default 'published' check (status in ('published', 'draft'))
);
create index on public.preview_image_rules (base_model_id, view);

-- ---------- 顧客の保存データ ----------
create table public.configurations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  base_model_id uuid not null references public.base_models (id),
  name text not null default '',
  status text not null default 'draft' check (status in ('draft', 'quote_requested', 'quoted', 'closed')),
  base_price integer not null default 0,
  option_subtotal integer not null default 0,
  installation_subtotal integer not null default 0,
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  preview_image_url text,
  notes text,
  partner_id uuid, -- 第三段階: 販売パートナー（partners テーブル）との紐付け用
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.configurations (user_id, updated_at desc);
create trigger trg_configurations_updated before update on public.configurations for each row execute function public.set_updated_at();

create table public.configuration_items (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  option_id uuid not null references public.options (id),
  quantity integer not null default 1 check (quantity >= 1),
  unique (configuration_id, option_id)
);

create table public.configuration_snapshots (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  reason text not null check (reason in ('saved', 'quote_requested')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.configuration_snapshots (configuration_id, created_at desc);

-- ---------- 見積 ----------
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  quote_id uuid,
  status text not null default 'new' check (status in ('new', 'reviewing', 'sent', 'closed', 'cancelled')),
  message text,
  contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.quote_requests (user_id, created_at desc);
create trigger trg_quote_requests_updated before update on public.quote_requests for each row execute function public.set_updated_at();

create table public.quote_sequences (
  year_month text primary key,
  last_no integer not null default 0
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text not null unique,
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  configuration_id uuid not null references public.configurations (id),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'issued' check (status in ('issued', 'expired', 'accepted', 'declined', 'cancelled')),
  issued_at timestamptz not null default now(),
  valid_until timestamptz not null,
  customer_name text not null,
  customer_company text,
  base_model_name text not null,
  base_price integer not null,
  option_subtotal integer not null,
  installation_subtotal integer not null,
  subtotal integer not null,
  tax_rate numeric(5, 4) not null,
  tax integer not null,
  total integer not null,
  preview_image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.quotes (user_id, issued_at desc);
create trigger trg_quotes_updated before update on public.quotes for each row execute function public.set_updated_at();
alter table public.quote_requests add constraint quote_requests_quote_fk foreign key (quote_id) references public.quotes (id) on delete set null;

-- 発行時点の名称・単価・数量・金額のスナップショット（マスター変更の影響を受けない）
create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  kind text not null check (kind in ('base', 'option', 'installation')),
  name text not null,
  description text,
  unit_price integer not null,
  quantity integer not null default 1,
  amount integer not null,
  sort_order integer not null default 0
);
create index on public.quote_items (quote_id, sort_order);

create table public.quote_documents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  byte_size integer not null default 0,
  generated_at timestamptz not null default now()
);
create index on public.quote_documents (quote_id, generated_at desc);

-- =============================================================
-- 将来段階の予約（第二・第三段階で追加。今は作らない）
--   contracts(quote_id, signed_at, provider_ref ...)         電子契約
--   drawing_approvals(configuration_id, file_url, status ...) 図面承認
--   partners(id, name, commission_rate ...)                   販売パートナー
--   configurations.partner_id → partners.id
-- =============================================================
