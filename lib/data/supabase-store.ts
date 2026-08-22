import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BaseModel,
  CatalogBundle,
  Configuration,
  ConfigurationItem,
  OptionCategory,
  PreviewImageRule,
  ProductImage,
  ProductOption,
  Profile,
  Quote,
  QuoteContact,
  QuoteDocument,
  QuoteItem,
  QuoteRequest,
  QuoteRequestStatus,
  QuoteStatus,
  ContactMessage,
  ContactStatus,
} from '@/lib/domain/types';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  StoreError,
  type ContactInput,
  type CategoryInput,
  type DataStore,
  type ModelInput,
  type OptionInput,
  type PreviewRuleInput,
  type ProductImageInput,
  type QuoteDetail,
  type SaveConfigurationInput,
  type SessionUser,
  type UploadInput,
} from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

function mapPgError(e: { code?: string; message?: string } | null): never {
  const msg = e?.message ?? '不明なエラー';
  if (msg.startsWith('CONFLICT:') || msg.startsWith('DEPENDENCY:') || msg.startsWith('REQUIRED:') || msg.startsWith('SINGLE:')) {
    throw new StoreError('VALIDATION', msg.replace(/^[A-Z_]+:\s*/, ''));
  }
  if (msg.startsWith('LOCKED')) throw new StoreError('LOCKED', msg.replace(/^LOCKED:\s*/, ''));
  if (msg.startsWith('FORBIDDEN') || e?.code === '42501') throw new StoreError('FORBIDDEN', '権限がありません');
  if (msg.startsWith('NOT_FOUND') || e?.code === 'P0002' || e?.code === 'PGRST116') throw new StoreError('NOT_FOUND', 'データが見つかりません');
  if (msg.startsWith('UNAUTHENTICATED')) throw new StoreError('UNAUTHENTICATED', 'ログインが必要です');
  if (msg.startsWith('QUOTE_IMMUTABLE')) throw new StoreError('LOCKED', '発行済み見積の金額は変更できません');
  throw new StoreError('INTERNAL', msg);
}

const num = (v: unknown) => Number(v ?? 0);

function toQuote(r: Record<string, unknown>): Quote {
  return { ...(r as unknown as Quote), tax_rate: num(r.tax_rate) };
}

export class SupabaseStore implements DataStore {
  private async db(): Promise<Db> {
    return (await createClient()) as unknown as Db;
  }

  // ---------- 商品 ----------
  async listModels(opts?: { includeDraft?: boolean }) {
    const db = await this.db();
    let q = db.from('base_models').select('*').order('sort_order');
    if (!opts?.includeDraft) q = q.eq('status', 'published');
    const { data, error } = await q;
    if (error) mapPgError(error);
    return (data ?? []) as BaseModel[];
  }
  async getModelBySlug(slug: string, opts?: { includeDraft?: boolean }) {
    const db = await this.db();
    let q = db.from('base_models').select('*').eq('slug', slug);
    if (!opts?.includeDraft) q = q.eq('status', 'published');
    const { data, error } = await q.maybeSingle();
    if (error) mapPgError(error);
    return (data as BaseModel | null) ?? null;
  }
  async getModelById(id: string, opts?: { includeDraft?: boolean }) {
    const db = await this.db();
    let q = db.from('base_models').select('*').eq('id', id);
    if (!opts?.includeDraft) q = q.eq('status', 'published');
    const { data, error } = await q.maybeSingle();
    if (error) mapPgError(error);
    return (data as BaseModel | null) ?? null;
  }
  async getCatalogBundle(modelId: string, opts?: { includeDraft?: boolean }): Promise<CatalogBundle | null> {
    const model = await this.getModelById(modelId, opts);
    if (!model) return null;
    const db = await this.db();
    const pub = <T extends { status: string }>(rows: T[]) => (opts?.includeDraft ? rows : rows.filter((r) => r.status === 'published'));
    const [images, categories, options, previewRules] = await Promise.all([
      db.from('product_images').select('*').eq('base_model_id', modelId).order('sort_order'),
      db.from('option_categories').select('*').order('sort_order'),
      db.from('options').select('*').or(`base_model_id.is.null,base_model_id.eq.${modelId}`).order('sort_order'),
      db.from('preview_image_rules').select('*').eq('base_model_id', modelId),
    ]);
    for (const r of [images, categories, options, previewRules]) if (r.error) mapPgError(r.error);
    const opts_ = pub((options.data ?? []) as ProductOption[]);
    const ids = opts_.map((o) => o.id);
    const [deps, confs] = ids.length
      ? await Promise.all([
          db.from('option_dependencies').select('*').in('option_id', ids),
          db.from('option_conflicts').select('*').in('option_id', ids),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (deps.error) mapPgError(deps.error);
    if (confs.error) mapPgError(confs.error);
    const idSet = new Set(ids);
    return {
      model,
      images: (images.data ?? []) as ProductImage[],
      categories: pub((categories.data ?? []) as OptionCategory[]),
      options: opts_,
      dependencies: ((deps.data ?? []) as CatalogBundle['dependencies']).filter((d) => idSet.has(d.requires_option_id)),
      conflicts: ((confs.data ?? []) as CatalogBundle['conflicts']).filter((c) => idSet.has(c.conflicts_with_option_id)),
      previewRules: pub((previewRules.data ?? []) as PreviewImageRule[]),
    };
  }

  // ---------- プロフィール ----------
  async getProfile(userId: string) {
    const db = await this.db();
    const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) mapPgError(error);
    return (data as Profile | null) ?? null;
  }
  async updateProfile(userId: string, patch: Partial<Profile>) {
    const db = await this.db();
    const { data, error } = await db.from('profiles').update(patch).eq('id', userId).select('*').single();
    if (error) mapPgError(error);
    return data as Profile;
  }
  async listProfiles() {
    const db = await this.db();
    const { data, error } = await db.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) mapPgError(error);
    return (data ?? []) as Profile[];
  }

  // ---------- 仕様 ----------
  async listConfigurations(userId: string) {
    const db = await this.db();
    const { data, error } = await db.from('configurations').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) mapPgError(error);
    return (data ?? []) as Configuration[];
  }
  async getConfiguration(id: string, actor: SessionUser) {
    void actor; // RLS が所有者チェックを行う
    const db = await this.db();
    const { data, error } = await db.from('configurations').select('*').eq('id', id).maybeSingle();
    if (error) mapPgError(error);
    if (!data) return null; // RLS により他人のデータは返らない
    const items = await db.from('configuration_items').select('*').eq('configuration_id', id);
    if (items.error) mapPgError(items.error);
    return { configuration: data as Configuration, items: (items.data ?? []) as ConfigurationItem[] };
  }
  async saveConfiguration(_actor: SessionUser, input: SaveConfigurationInput): Promise<Configuration> {
    const db = await this.db();
    const { data, error } = await db.rpc('save_configuration', {
      p_configuration_id: input.id,
      p_base_model_id: input.base_model_id,
      p_name: input.name,
      p_option_ids: input.option_ids,
      p_preview_image_url: input.preview_image_url,
      p_notes: input.notes,
    });
    if (error) mapPgError(error);
    return data as Configuration;
  }
  async duplicateConfiguration(id: string) {
    const db = await this.db();
    const { data, error } = await db.rpc('duplicate_configuration', { p_configuration_id: id });
    if (error) mapPgError(error);
    return data as Configuration;
  }
  async deleteConfiguration(id: string) {
    const db = await this.db();
    const { error, count } = await db.from('configurations').delete({ count: 'exact' }).eq('id', id);
    if (error) mapPgError(error);
    if (!count) throw new StoreError('NOT_FOUND', '保存データが見つかりません');
  }
  async listAllConfigurations() {
    const db = await this.db();
    const { data, error } = await db
      .from('configurations')
      .select('*, profiles!configurations_user_id_fkey(email, full_name)')
      .order('updated_at', { ascending: false });
    if (error) mapPgError(error);
    return ((data ?? []) as (Configuration & { profiles: { email: string; full_name: string } | null })[]).map(
      ({ profiles, ...c }) => ({ ...c, user_email: profiles?.email ?? '', user_name: profiles?.full_name ?? '' })
    );
  }

  // ---------- 見積 ----------
  async createQuoteFromConfiguration(actor: SessionUser, configurationId: string, contact: QuoteContact, message: string | null) {
    const db = await this.db();
    const { data, error } = await db.rpc('create_quote_from_configuration', {
      p_configuration_id: configurationId,
      p_contact: contact,
      p_message: message,
    });
    if (error) mapPgError(error);
    const detail = await this.getQuote(data as string, actor);
    if (!detail) throw new StoreError('INTERNAL', '見積の取得に失敗しました');
    return detail.quote;
  }
  async listQuotes(userId: string) {
    const db = await this.db();
    const { data, error } = await db.from('quotes').select('*').eq('user_id', userId).order('issued_at', { ascending: false });
    if (error) mapPgError(error);
    return ((data ?? []) as Record<string, unknown>[]).map(toQuote);
  }
  async listQuotesByConfiguration(userId: string) {
    const list = await this.listQuotes(userId);
    const map = new Map<string, Quote>();
    for (const q of list) if (!map.has(q.configuration_id)) map.set(q.configuration_id, q);
    return map;
  }
  async getQuote(id: string, actor: SessionUser): Promise<QuoteDetail | null> {
    const db = await this.db();
    const { data, error } = await db.from('quotes').select('*').eq('id', id).maybeSingle();
    if (error) mapPgError(error);
    if (!data) return null;
    const quote = toQuote(data as Record<string, unknown>);
    const [items, request, document, profile] = await Promise.all([
      db.from('quote_items').select('*').eq('quote_id', id).order('sort_order'),
      db.from('quote_requests').select('*').eq('id', quote.quote_request_id).maybeSingle(),
      db.from('quote_documents').select('*').eq('quote_id', id).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      actor.role === 'admin' ? db.from('profiles').select('*').eq('id', quote.user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (items.error) mapPgError(items.error);
    return {
      quote,
      items: (items.data ?? []) as QuoteItem[],
      request: (request.data as QuoteRequest | null) ?? null,
      document: (document.data as QuoteDocument | null) ?? null,
      profile: (profile.data as Profile | null) ?? null,
    };
  }
  async listAllQuotes() {
    const db = await this.db();
    const { data, error } = await db.from('quotes').select('*, profiles!quotes_user_id_fkey(email)').order('issued_at', { ascending: false });
    if (error) mapPgError(error);
    return ((data ?? []) as (Record<string, unknown> & { profiles: { email: string } | null })[]).map(({ profiles, ...q }) => ({
      ...toQuote(q),
      user_email: profiles?.email ?? '',
    }));
  }
  async listQuoteRequests() {
    const db = await this.db();
    const { data, error } = await db
      .from('quote_requests')
      .select('*, profiles!quote_requests_user_id_fkey(email), quotes!quote_requests_quote_fk(quote_no)')
      .order('created_at', { ascending: false });
    if (error) mapPgError(error);
    return ((data ?? []) as (QuoteRequest & { profiles: { email: string } | null; quotes: { quote_no: string } | null })[]).map(
      ({ profiles, quotes, ...r }) => ({ ...r, quote_no: quotes?.quote_no ?? null, user_email: profiles?.email ?? '' })
    );
  }
  async updateQuoteStatus(id: string, status: QuoteStatus, requestStatus: QuoteRequestStatus | null) {
    const db = await this.db();
    const { data, error } = await db.from('quotes').update({ status }).eq('id', id).select('quote_request_id, configuration_id').single();
    if (error) mapPgError(error);
    const row = data as { quote_request_id: string; configuration_id: string };
    if (requestStatus) {
      const r = await db.from('quote_requests').update({ status: requestStatus }).eq('id', row.quote_request_id);
      if (r.error) mapPgError(r.error);
    }
    const cfgStatus = status === 'issued' ? 'quoted' : status === 'expired' ? null : 'closed';
    if (cfgStatus) {
      const c = await db.from('configurations').update({ status: cfgStatus }).eq('id', row.configuration_id);
      if (c.error) mapPgError(c.error);
    }
  }

  // ---------- PDF（service role） ----------
  async getQuoteDocumentFile(quoteId: string) {
    const db = await this.db();
    const { data: doc, error } = await db
      .from('quote_documents')
      .select('*')
      .eq('quote_id', quoteId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) mapPgError(error);
    if (!doc) return null;
    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage.from('quote-documents').download((doc as QuoteDocument).storage_path);
    if (dlError || !blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), document: doc as QuoteDocument };
  }
  async saveQuoteDocument(quoteId: string, bytes: Uint8Array, fileName: string) {
    const admin = createAdminClient();
    const storagePath = `quotes/${quoteId}.pdf`;
    const up = await admin.storage.from('quote-documents').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new StoreError('INTERNAL', up.error.message);
    const { data, error } = await admin
      .from('quote_documents')
      .insert({ quote_id: quoteId, storage_path: storagePath, file_name: fileName, byte_size: bytes.byteLength })
      .select('*')
      .single();
    if (error) mapPgError(error);
    return data as QuoteDocument;
  }

  // ---------- 管理 ----------
  private async upsert<T>(table: string, input: { id?: string | null } & Record<string, unknown>): Promise<T> {
    const db = await this.db();
    const { id, ...rest } = input;
    const q = id ? db.from(table).update(rest).eq('id', id) : db.from(table).insert(rest);
    const { data, error } = await q.select('*').single();
    if (error) mapPgError(error);
    return data as T;
  }
  async upsertModel(input: ModelInput) {
    return this.upsert<BaseModel>('base_models', input);
  }
  async listCategories() {
    const db = await this.db();
    const { data, error } = await db.from('option_categories').select('*').order('sort_order');
    if (error) mapPgError(error);
    return (data ?? []) as OptionCategory[];
  }
  async upsertCategory(input: CategoryInput) {
    return this.upsert<OptionCategory>('option_categories', input);
  }
  async listOptions() {
    const db = await this.db();
    const { data, error } = await db.from('options').select('*').order('sort_order');
    if (error) mapPgError(error);
    return (data ?? []) as ProductOption[];
  }
  async getOption(id: string) {
    const db = await this.db();
    const { data, error } = await db.from('options').select('*').eq('id', id).maybeSingle();
    if (error) mapPgError(error);
    return (data as ProductOption | null) ?? null;
  }
  async upsertOption(input: OptionInput) {
    return this.upsert<ProductOption>('options', input);
  }
  async deleteOption(id: string) {
    const db = await this.db();
    const used = await db.from('configuration_items').select('id', { count: 'exact', head: true }).eq('option_id', id);
    if ((used.count ?? 0) > 0) {
      throw new StoreError('VALIDATION', '保存済みの仕様で使用されているため削除できません。非公開にしてください。');
    }
    const { error } = await db.from('options').delete().eq('id', id);
    if (error) mapPgError(error);
  }
  async setOptionRelations(
    optionId: string,
    dependencies: { requires_option_id: string; message: string | null }[],
    conflicts: { conflicts_with_option_id: string; message: string | null }[]
  ) {
    const db = await this.db();
    const d1 = await db.from('option_dependencies').delete().eq('option_id', optionId);
    if (d1.error) mapPgError(d1.error);
    const d2 = await db.from('option_conflicts').delete().eq('option_id', optionId);
    if (d2.error) mapPgError(d2.error);
    if (dependencies.length) {
      const r = await db.from('option_dependencies').insert(dependencies.map((d) => ({ option_id: optionId, ...d })));
      if (r.error) mapPgError(r.error);
    }
    if (conflicts.length) {
      const r = await db.from('option_conflicts').insert(conflicts.map((c) => ({ option_id: optionId, ...c })));
      if (r.error) mapPgError(r.error);
    }
  }
  async upsertPreviewRule(input: PreviewRuleInput) {
    return this.upsert<PreviewImageRule>('preview_image_rules', input);
  }
  async deletePreviewRule(id: string) {
    const db = await this.db();
    const { error } = await db.from('preview_image_rules').delete().eq('id', id);
    if (error) mapPgError(error);
  }
  async addProductImage(input: ProductImageInput) {
    return this.upsert<ProductImage>('product_images', input);
  }
  async deleteProductImage(id: string) {
    const db = await this.db();
    const { error } = await db.from('product_images').delete().eq('id', id);
    if (error) mapPgError(error);
  }
  // ---------- お問い合わせ（保存は service role、閲覧は管理者 RLS） ----------
  async createContactMessage(input: ContactInput): Promise<ContactMessage> {
    const admin = createAdminClient();
    let attachment_path: string | null = null;
    if (input.attachment) {
      const ext = (input.attachment.fileName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      attachment_path = `contact/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const up = await admin.storage
        .from('contact-attachments')
        .upload(attachment_path, input.attachment.bytes, { contentType: input.attachment.contentType, upsert: false });
      if (up.error) throw new StoreError('INTERNAL', up.error.message);
    }
    const { data, error } = await admin
      .from('contact_messages')
      .insert({
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        topic: input.topic,
        message: input.message,
        attachment_path,
        attachment_name: input.attachment?.fileName ?? null,
      })
      .select('*')
      .single();
    if (error) mapPgError(error);
    return data as ContactMessage;
  }
  async listContactMessages() {
    const db = await this.db();
    const { data, error } = await db.from('contact_messages').select('*').order('created_at', { ascending: false });
    if (error) mapPgError(error);
    return (data ?? []) as ContactMessage[];
  }
  async updateContactStatus(id: string, status: ContactStatus) {
    const db = await this.db();
    const { error } = await db.from('contact_messages').update({ status }).eq('id', id);
    if (error) mapPgError(error);
  }

  async uploadImage(file: UploadInput, folder: string) {
    const admin = createAdminClient();
    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '') || 'uploads';
    const ext = (file.fileName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const storagePath = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const up = await admin.storage.from('product-images').upload(storagePath, file.bytes, { contentType: file.contentType, upsert: false });
    if (up.error) throw new StoreError('INTERNAL', up.error.message);
    return admin.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl;
  }
}
