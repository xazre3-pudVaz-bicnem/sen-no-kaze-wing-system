import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BaseBreakdownItem,
  BaseModel,
  CatalogBundle,
  Configuration,
  FinishLevel,
  OptionCategory,
  PreviewImageRule,
  PreviewHotspot,
  ProductImage,
  ProductOption,
  AppNotification,
  OptionVariantChoice,
  OptionVariantGroup,
  Profile,
  RoleCode,
  Quote,
  QuoteContact,
  QuoteDocument,
  QuoteRequest,
  QuoteRequestStatus,
  QuoteStatus,
  ContactMessage,
  ContactStatus,
} from '@/lib/domain/types';
import { computePricing } from '@/lib/domain/pricing';
import { categoriesInScope, validateSelection } from '@/lib/domain/rules';
import { hasRoleAtLeast } from '@/lib/domain/types';
import { ROUNDING_UNIT } from '@/lib/domain/pricing';
import { COMPANY, QUOTE_VALID_DAYS } from '@/lib/site';
import { addDays, yearMonthJst } from '@/lib/utils';
import {
  catalogImportPathsForUser,
  catalogImportUploadPath,
  catalogImportUrlsForUser,
  localCatalogImportUrl,
} from '@/lib/import/catalog-import-images';
import { filesDir, loadDb, saveDb, type LocalDb } from './local-db';
import {
  StoreError,
  type ContactInput,
  type CategoryInput,
  type CatalogImportBatch,
  type DataStore,
  type ModelInput,
  type OptionInput,
  type PreviewRuleInput,
  type HotspotInput,
  type ProductImageInput,
  type QuoteDetail,
  type SaveConfigurationInput,
  type SessionUser,
  type UploadInput,
  type DealerRevisionInput,
  type DealerRevisionItem,
} from './store';

const nowIso = () => new Date().toISOString();

export class LocalStore implements DataStore {
  private mutate<T>(fn: (db: LocalDb) => T): T {
    const db = loadDb();
    const result = fn(db);
    saveDb(db);
    return result;
  }
  private read<T>(fn: (db: LocalDb) => T): T {
    return fn(loadDb());
  }

  // ---------- 商品 ----------
  async listModels(opts?: { includeDraft?: boolean }) {
    return this.read((db) =>
      db.models.filter((m) => opts?.includeDraft || m.status === 'published').sort((a, b) => a.sort_order - b.sort_order)
    );
  }
  async getModelBySlug(slug: string, opts?: { includeDraft?: boolean }) {
    return this.read((db) => db.models.find((m) => m.slug === slug && (opts?.includeDraft || m.status === 'published')) ?? null);
  }
  async getModelById(id: string, opts?: { includeDraft?: boolean }) {
    return this.read((db) => db.models.find((m) => m.id === id && (opts?.includeDraft || m.status === 'published')) ?? null);
  }
  async getCatalogBundle(modelId: string, opts?: { includeDraft?: boolean }): Promise<CatalogBundle | null> {
    return this.read((db) => {
      const model = db.models.find((m) => m.id === modelId && (opts?.includeDraft || m.status === 'published'));
      if (!model) return null;
      const pub = <T extends { status: string }>(x: T) => opts?.includeDraft || x.status === 'published';
      const options = db.options
        .filter((o) => (o.base_model_id === null || o.base_model_id === modelId) && pub(o))
        .sort((a, b) => a.sort_order - b.sort_order);
      const ids = new Set(options.map((o) => o.id));
      return {
        model,
        images: db.images.filter((i) => i.base_model_id === modelId).sort((a, b) => a.sort_order - b.sort_order),
        categories: db.categories.filter(pub).sort((a, b) => a.sort_order - b.sort_order),
        options,
        dependencies: db.dependencies.filter((d) => ids.has(d.option_id) && ids.has(d.requires_option_id)),
        conflicts: db.conflicts.filter((c) => ids.has(c.option_id) && ids.has(c.conflicts_with_option_id)),
        previewRules: db.previewRules.filter((r) => r.base_model_id === modelId && pub(r)),
        hotspots: db.hotspots.filter((h) => db.previewRules.some((r) => r.id === h.rule_id && r.base_model_id === modelId)),
        variantGroups: db.variantGroups.filter((g) => ids.has(g.option_id) && pub(g)),
        variantChoices: db.variantChoices.filter(
          (c) => pub(c) && db.variantGroups.some((g) => g.id === c.group_id && ids.has(g.option_id))
        ),
        baseBreakdowns: db.baseBreakdownItems
          .filter((b) => b.base_model_id === modelId)
          .sort((a, b) => a.sort_order - b.sort_order),
      };
    });
  }

  /** 商品価格の一括更新。価格変更は監査ログに残す */
  async updateOptionPrices(items: { id: string; price: number }[]) {
    this.mutate((db) => {
      for (const it of items) {
        const o = db.options.find((x) => x.id === it.id);
        if (!o || o.price === it.price) continue;
        const before = o.price;
        o.price = it.price;
        o.updated_at = nowIso();
        this.pushAudit(db, null, {
          action: 'price',
          entity: 'option',
          entity_id: o.id,
          summary: `価格を変更：${o.name}（${before} → ${o.price} 円）`,
        });
      }
    });
  }

  // ---------- 本体内訳マスター ----------
  async listBaseBreakdownItems(modelId?: string) {
    return this.read((db) =>
      db.baseBreakdownItems
        .filter((b) => !modelId || b.base_model_id === modelId)
        .sort((a, b) => a.spec_code.localeCompare(b.spec_code) || a.sort_order - b.sort_order)
    );
  }
  async saveBaseBreakdownItems(
    modelId: string,
    specCode: string,
    items: Omit<BaseBreakdownItem, 'id' | 'base_model_id' | 'spec_code' | 'sort_order' | 'amount'>[]
  ) {
    return this.mutate((db) => {
      db.baseBreakdownItems = db.baseBreakdownItems.filter((b) => !(b.base_model_id === modelId && b.spec_code === specCode));
      const rows: BaseBreakdownItem[] = items.map((it, i) => ({
        id: randomUUID(),
        base_model_id: modelId,
        spec_code: specCode,
        section: it.section,
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        amount: Math.round(it.unit_price * it.quantity),
        remark: it.remark,
        sort_order: i + 1,
      }));
      db.baseBreakdownItems.push(...rows);
      this.pushAudit(db, null, {
        action: 'update',
        entity: 'base_breakdown',
        entity_id: modelId,
        summary: `本体内訳を更新（${specCode}・${rows.length}行）`,
      });
      return rows;
    });
  }

  // ---------- 通知・監査ログ ----------
  /** SQL 側はトリガーで作るので、ローカル実装でも同じ場所から呼ぶ */
  private pushNotification(
    db: LocalDb,
    n: { recipient_id: string | null; audience: AppNotification['audience']; kind: string; title: string; body?: string | null; link?: string | null }
  ) {
    db.notifications.push({
      id: randomUUID(),
      recipient_id: n.recipient_id,
      audience: n.audience,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      read_at: null,
      email_status: 'pending',
      email_error: null,
      created_at: nowIso(),
    });
  }

  private pushAudit(
    db: LocalDb,
    actor: SessionUser | null,
    a: { action: string; entity: string; entity_id: string | null; summary: string }
  ) {
    db.auditLogs.push({
      id: randomUUID(),
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action: a.action,
      entity: a.entity,
      entity_id: a.entity_id,
      summary: a.summary,
      created_at: nowIso(),
    });
  }

  async listNotifications(actor: SessionUser, opts?: { limit?: number }) {
    return this.read((db) =>
      db.notifications
        .filter((n) => (actor.role === 'admin' ? n.recipient_id === null || n.recipient_id === actor.id : n.recipient_id === actor.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, opts?.limit ?? 50)
    );
  }
  async markNotificationRead(id: string, actor: SessionUser) {
    this.mutate((db) => {
      const n = db.notifications.find((x) => x.id === id);
      if (!n) return;
      if (!(actor.role === 'admin' || n.recipient_id === actor.id)) throw new StoreError('FORBIDDEN', '権限がありません');
      n.read_at = nowIso();
    });
  }
  async markAllNotificationsRead(actor: SessionUser) {
    this.mutate((db) => {
      for (const n of db.notifications) {
        const mine = actor.role === 'admin' ? n.recipient_id === null || n.recipient_id === actor.id : n.recipient_id === actor.id;
        if (mine && !n.read_at) n.read_at = nowIso();
      }
    });
  }
  async listAuditLogs(opts?: { limit?: number }) {
    return this.read((db) => [...db.auditLogs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, opts?.limit ?? 200));
  }

  async respondToQuote(id: string, status: 'accepted' | 'declined', actor: SessionUser) {
    return this.mutate((db) => {
      const q = db.quotes.find((x) => x.id === id);
      if (!q) throw new StoreError('NOT_FOUND', '見積が見つかりません');
      if (q.user_id !== actor.id) throw new StoreError('FORBIDDEN', '権限がありません');
      if (q.status !== 'issued') throw new StoreError('LOCKED', 'この見積にはすでに回答済みです（または改訂されています）。');
      q.status = status;
      q.updated_at = nowIso();
      const cfg = db.configurations.find((c) => c.id === q.configuration_id);
      if (cfg) cfg.status = 'closed';
      const label = status === 'accepted' ? '承諾' : '辞退';
      this.pushNotification(db, {
        recipient_id: null,
        audience: 'admin',
        kind: `quote_${status}`,
        title: `見積が${label}されました：${q.quote_no}`,
        body: `${q.customer_name} 様が回答しました。`,
        link: `/admin/quotes/${q.id}`,
      });
      if (q.dealer_id) {
        this.pushNotification(db, {
          recipient_id: q.dealer_id,
          audience: 'dealer',
          kind: `quote_${status}`,
          title: `担当見積が${label}されました：${q.quote_no}`,
          body: `${q.customer_name} 様が回答しました。`,
          link: `/admin/quotes/${q.id}`,
        });
      }
      return q;
    });
  }

  // ---------- プロフィール ----------
  async getProfile(userId: string) {
    return this.read((db) => db.profiles.find((p) => p.id === userId) ?? null);
  }
  async updateProfile(userId: string, patch: Partial<Profile>) {
    return this.mutate((db) => {
      const p = db.profiles.find((x) => x.id === userId);
      if (!p) throw new StoreError('NOT_FOUND', 'プロフィールが見つかりません');
      Object.assign(p, patch, { updated_at: nowIso() });
      return p;
    });
  }
  async updateUserRole(userId: string, role: RoleCode, actor: SessionUser) {
    return this.mutate((db) => {
      if (actor.role !== 'admin') throw new StoreError('FORBIDDEN', '権限を変更できるのは管理者だけです');
      if (actor.id === userId) throw new StoreError('VALIDATION', '自分自身の権限は変更できません');
      const p = db.profiles.find((x) => x.id === userId);
      if (!p) throw new StoreError('NOT_FOUND', 'ユーザーが見つかりません');
      const before = p.role_code;
      p.role_code = role;
      p.updated_at = nowIso();
      this.pushAudit(db, actor, {
        action: 'role',
        entity: 'profile',
        entity_id: p.id,
        summary: `権限を変更：${p.full_name}（${before} → ${role}）`,
      });
      return p;
    });
  }
  async listProfiles() {
    return this.read((db) => [...db.profiles].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  // ---------- 仕様 ----------
  private canAccess(actor: SessionUser, ownerId: string) {
    return actor.role === 'admin' || actor.id === ownerId;
  }
  async listConfigurations(userId: string) {
    return this.read((db) =>
      db.configurations.filter((c) => c.user_id === userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
  }
  async getConfiguration(id: string, actor: SessionUser) {
    return this.read((db) => {
      const configuration = db.configurations.find((c) => c.id === id);
      if (!configuration || !this.canAccess(actor, configuration.user_id)) return null;
      return { configuration, items: db.configurationItems.filter((i) => i.configuration_id === id) };
    });
  }
  private recalc(db: LocalDb, cfg: Configuration) {
    const model = db.models.find((m) => m.id === cfg.base_model_id);
    if (!model) throw new StoreError('NOT_FOUND', 'モデルが見つかりません');
    const items = db.configurationItems.filter((i) => i.configuration_id === cfg.id);
    // 本体内訳マスター（仕様別）が登録されていれば、その合計を本体一式とする
    const breakdown = db.baseBreakdownItems.filter(
      (b) => b.base_model_id === cfg.base_model_id && b.spec_code === (cfg.spec_code ?? '')
    );
    const baseOverride = breakdown.length ? breakdown.reduce((sum, b) => sum + b.amount, 0) : null;
    const pricing = computePricing(
      model,
      db.options,
      db.categories,
      items.map((i) => ({ option_id: i.option_id, quantity: i.quantity, variant_choice_ids: i.variant_choice_ids ?? [] })),
      undefined,
      { groups: db.variantGroups, choices: db.variantChoices },
      baseOverride
    );
    Object.assign(cfg, {
      base_price: pricing.base_price,
      base_expense: pricing.base_expense,
      option_subtotal: pricing.option_subtotal,
      option_expense: pricing.option_expense,
      installation_subtotal: pricing.installation_subtotal,
      adjustment: pricing.adjustment,
      subtotal: pricing.subtotal,
      tax: pricing.tax,
      total: pricing.total,
      updated_at: nowIso(),
    });
    return { pricing, model };
  }
  async saveConfiguration(actor: SessionUser, input: SaveConfigurationInput): Promise<Configuration> {
    return this.mutate((db) => {
      const model = db.models.find((m) => m.id === input.base_model_id && m.status === 'published');
      if (!model) throw new StoreError('VALIDATION', '公開中のモデルではありません');
      const level: FinishLevel = input.finish_level ?? 'full';
      const scope = new Set(categoriesInScope(db.categories, level).map((c) => c.id));
      const valid = db.options.filter(
        (o) =>
          input.option_ids.includes(o.id) &&
          o.status === 'published' &&
          (o.base_model_id === null || o.base_model_id === model.id) &&
          scope.has(o.category_id)
      );
      const ids = [...new Set(valid.map((o) => o.id))];
      const issues = validateSelection(
        { options: db.options, categories: db.categories, dependencies: db.dependencies, conflicts: db.conflicts },
        ids,
        level
      );
      if (issues.length) throw new StoreError('VALIDATION', issues.map((i) => i.message).join(' '));

      let cfg: Configuration;
      if (input.id) {
        const found = db.configurations.find((c) => c.id === input.id);
        if (!found) throw new StoreError('NOT_FOUND', '保存データが見つかりません');
        if (!this.canAccess(actor, found.user_id)) throw new StoreError('FORBIDDEN', '権限がありません');
        if (found.status !== 'draft' && actor.role !== 'admin') {
          throw new StoreError('LOCKED', '見積依頼済みの仕様は編集できません。複製して編集してください。');
        }
        cfg = found;
        cfg.name = input.name || cfg.name;
        cfg.finish_level = level;
        cfg.spec_code = input.spec_code ?? cfg.spec_code ?? null;
        cfg.preview_image_url = input.preview_image_url;
        cfg.notes = input.notes;
        db.configurationItems = db.configurationItems.filter((i) => i.configuration_id !== cfg.id);
      } else {
        cfg = {
          id: randomUUID(),
          user_id: actor.id,
          base_model_id: model.id,
          name: input.name || '無題の仕様',
          status: 'draft',
          finish_level: level,
          spec_code: input.spec_code ?? null,
          base_price: 0,
          base_expense: 0,
          option_subtotal: 0,
          option_expense: 0,
          installation_subtotal: 0,
          adjustment: 0,
          subtotal: 0,
          tax: 0,
          total: 0,
          preview_image_url: input.preview_image_url,
          notes: input.notes,
          partner_id: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        db.configurations.push(cfg);
      }
      // その商品の選択項目に属する選択肢だけを紐づける
      const wantVariants = new Set(input.variant_choice_ids ?? []);
      for (const id of ids) {
        const mine = db.variantChoices
          .filter((c) => wantVariants.has(c.id) && db.variantGroups.some((g) => g.id === c.group_id && g.option_id === id))
          .map((c) => c.id);
        db.configurationItems.push({ id: randomUUID(), configuration_id: cfg.id, option_id: id, quantity: 1, variant_choice_ids: mine });
      }
      const { pricing } = this.recalc(db, cfg);
      db.snapshots.push({
        id: randomUUID(),
        configuration_id: cfg.id,
        reason: 'saved',
        snapshot: { ...pricing, model_name: model.name },
        created_at: nowIso(),
      });
      return cfg;
    });
  }
  async duplicateConfiguration(id: string, actor: SessionUser) {
    return this.mutate((db) => {
      const src = db.configurations.find((c) => c.id === id);
      if (!src) throw new StoreError('NOT_FOUND', '保存データが見つかりません');
      if (!this.canAccess(actor, src.user_id)) throw new StoreError('FORBIDDEN', '権限がありません');
      const copy: Configuration = {
        ...src,
        id: randomUUID(),
        name: `${src.name}（コピー）`,
        status: 'draft',
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.configurations.push(copy);
      for (const it of db.configurationItems.filter((i) => i.configuration_id === src.id)) {
        db.configurationItems.push({ ...it, id: randomUUID(), configuration_id: copy.id });
      }
      this.recalc(db, copy);
      return copy;
    });
  }
  async deleteConfiguration(id: string, actor: SessionUser) {
    this.mutate((db) => {
      const cfg = db.configurations.find((c) => c.id === id);
      if (!cfg) throw new StoreError('NOT_FOUND', '保存データが見つかりません');
      if (!this.canAccess(actor, cfg.user_id)) throw new StoreError('FORBIDDEN', '権限がありません');
      if (db.quotes.some((q) => q.configuration_id === id)) {
        throw new StoreError('VALIDATION', '見積を発行済みの仕様は削除できません。見積履歴として残ります。');
      }
      db.configurations = db.configurations.filter((c) => c.id !== id);
      db.configurationItems = db.configurationItems.filter((i) => i.configuration_id !== id);
      db.snapshots = db.snapshots.filter((s) => s.configuration_id !== id);
    });
  }
  async listAllConfigurations() {
    return this.read((db) =>
      [...db.configurations]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((c) => {
          const p = db.profiles.find((x) => x.id === c.user_id);
          return { ...c, user_email: p?.email ?? '', user_name: p?.full_name ?? '' };
        })
    );
  }

  // ---------- 見積 ----------
  private nextQuoteNo(db: LocalDb) {
    const ym = yearMonthJst();
    const n = (db.quoteSequences[ym] ?? 0) + 1;
    db.quoteSequences[ym] = n;
    return `Q${ym}-${String(n).padStart(4, '0')}`;
  }
  async createQuoteFromConfiguration(actor: SessionUser, configurationId: string, contact: QuoteContact, message: string | null) {
    return this.mutate((db) => {
      const cfg = db.configurations.find((c) => c.id === configurationId);
      if (!cfg) throw new StoreError('NOT_FOUND', '保存データが見つかりません');
      if (cfg.user_id !== actor.id) throw new StoreError('FORBIDDEN', '権限がありません');
      const items = db.configurationItems.filter((i) => i.configuration_id === cfg.id);
      const issues = validateSelection(
        { options: db.options, categories: db.categories, dependencies: db.dependencies, conflicts: db.conflicts },
        items.map((i) => i.option_id),
        cfg.finish_level ?? 'full'
      );
      if (issues.length) throw new StoreError('VALIDATION', issues.map((i) => i.message).join(' '));
      const { pricing, model } = this.recalc(db, cfg);

      const req: QuoteRequest = {
        id: randomUUID(),
        configuration_id: cfg.id,
        user_id: actor.id,
        quote_id: null,
        status: 'new',
        message,
        contact,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const issued = new Date();
      const quote: Quote = {
        id: randomUUID(),
        quote_no: this.nextQuoteNo(db),
        quote_request_id: req.id,
        configuration_id: cfg.id,
        user_id: actor.id,
        status: 'issued',
        issued_at: issued.toISOString(),
        valid_until: addDays(issued, QUOTE_VALID_DAYS).toISOString(),
        customer_no: db.profiles.find((p) => p.id === actor.id)?.customer_no ?? null,
        customer_name: contact.full_name,
        customer_company: contact.company_name,
        base_model_name: model.name,
        finish_level: cfg.finish_level,
        dealer_note: null,
        revision: 1,
        parent_quote_id: null,
        base_price: pricing.base_price,
        base_expense: pricing.base_expense,
        option_subtotal: pricing.option_subtotal,
        option_expense: pricing.option_expense,
        installation_subtotal: pricing.installation_subtotal,
        adjustment: pricing.adjustment,
        subtotal: pricing.subtotal,
        tax_rate: pricing.tax_rate,
        tax: pricing.tax,
        total: pricing.total,
        // 代理店・総代理店が自分で作成した見積は、自分が担当になる
        dealer_id: actor.role === 'dealer' || actor.role === 'master_dealer' ? actor.id : null,
        preview_image_url: cfg.preview_image_url,
        notes: COMPANY.quoteNotes[0],
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      req.quote_id = quote.id;
      db.quoteRequests.push(req);
      db.quotes.push(quote);
      this.pushNotification(db, {
        recipient_id: null,
        audience: 'admin',
        kind: 'quote_requested',
        title: `新しい見積依頼：${quote.quote_no}`,
        body: `${quote.customer_name} 様から見積依頼が届きました。担当代理店を割り当ててください。`,
        link: `/admin/quotes/${quote.id}`,
      });
      const ratePct = Math.round(pricing.expense_rate * 100);
      // 本体：内訳マスター（分類表見積書）があれば行に展開、なければ従来どおり一式 1 行
      const breakdown = db.baseBreakdownItems
        .filter((b) => b.base_model_id === model.id && b.spec_code === (cfg.spec_code ?? ''))
        .sort((a, b) => a.sort_order - b.sort_order);
      if (breakdown.length) {
        breakdown.forEach((b, i) =>
          db.quoteItems.push({
            id: randomUUID(),
            quote_id: quote.id,
            kind: 'base',
            name: b.name,
            description: b.section,
            unit: b.unit,
            remark: b.remark,
            unit_price: b.unit_price,
            quantity: b.quantity,
            amount: b.amount,
            image_url: null,
            sort_order: i,
          })
        );
      } else {
        db.quoteItems.push({
          id: randomUUID(),
          quote_id: quote.id,
          kind: 'base',
          name: `${model.name} 本体一式`,
          description: '工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）',
          unit: '式',
          remark: null,
          unit_price: pricing.base_price,
          quantity: 1,
          amount: pricing.base_price,
          image_url: null,
          sort_order: 0,
        });
      }
      db.quoteItems.push({
        id: randomUUID(),
        quote_id: quote.id,
        kind: 'base_expense',
        name: '本体諸費用',
        description: `交通費、労災、安全管理費等（${ratePct}%）`,
        unit: '式',
        remark: null,
        unit_price: pricing.base_expense,
        quantity: 1,
        amount: pricing.base_expense,
        image_url: null,
        sort_order: 900,
      });
      const ordered = [...pricing.lines].sort((a, b) => Number(a.is_installation) - Number(b.is_installation));
      ordered.forEach((l, i) =>
        db.quoteItems.push({
          id: randomUUID(),
          quote_id: quote.id,
          kind: l.is_free_product ? 'free' : l.is_installation ? 'installation' : 'option',
          // 選んだ仕様（壁色など）は見積書にも残す
          name: l.variants.length ? `${l.name}（${l.variants.map((v) => `${v.group}：${v.choice}`).join('／')}）` : l.name,
          description: l.price_on_request ? '設置場所確認後に別途お見積り' : l.category_name,
          unit: '式',
          remark: null,
          unit_price: l.unit_price,
          quantity: l.quantity,
          amount: l.amount,
          image_url: l.image_url,
          sort_order: 1000 + i,
        })
      );
      db.quoteItems.push({
        id: randomUUID(),
        quote_id: quote.id,
        kind: 'option_expense',
        name: 'オプション諸費用',
        description: `交通費、労災、安全管理費等（${ratePct}%）`,
        unit: '式',
        remark: null,
        unit_price: pricing.option_expense,
        quantity: 1,
        amount: pricing.option_expense,
        image_url: null,
        sort_order: 9000,
      });
      cfg.status = 'quote_requested';
      db.snapshots.push({
        id: randomUUID(),
        configuration_id: cfg.id,
        reason: 'quote_requested',
        snapshot: { ...pricing, model_name: model.name },
        created_at: nowIso(),
      });
      return quote;
    });
  }
  async listQuotes(userId: string) {
    return this.read((db) => db.quotes.filter((q) => q.user_id === userId).sort((a, b) => b.issued_at.localeCompare(a.issued_at)));
  }
  async listQuotesByConfiguration(userId: string) {
    const list = await this.listQuotes(userId);
    const map = new Map<string, Quote>();
    for (const q of list) if (!map.has(q.configuration_id)) map.set(q.configuration_id, q);
    return map;
  }
  async getQuote(id: string, actor: SessionUser): Promise<QuoteDetail | null> {
    return this.read((db) => {
      const quote = db.quotes.find((q) => q.id === id);
      // 顧客本人・管理者に加え、担当代理店も閲覧できる（別途工事を入力するため）。
      // 総代理店は本体明細を編集するため全件を見られる
      const dealerAccess =
        hasRoleAtLeast(actor.role, 'master_dealer') || (hasRoleAtLeast(actor.role, 'dealer') && quote?.dealer_id === actor.id);
      if (!quote || !(this.canAccess(actor, quote.user_id) || dealerAccess)) return null;
      return {
        quote,
        items: db.quoteItems.filter((i) => i.quote_id === id).sort((a, b) => a.sort_order - b.sort_order),
        request: db.quoteRequests.find((r) => r.id === quote.quote_request_id) ?? null,
        document: db.quoteDocuments.filter((d) => d.quote_id === id).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null,
        profile: db.profiles.find((p) => p.id === quote.user_id) ?? null,
      };
    });
  }
  async listAllQuotes() {
    return this.read((db) =>
      [...db.quotes]
        .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
        .map((q) => ({ ...q, user_email: db.profiles.find((p) => p.id === q.user_id)?.email ?? '' }))
    );
  }
  async listQuoteRequests() {
    return this.read((db) =>
      [...db.quoteRequests]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => ({
          ...r,
          quote_no: db.quotes.find((q) => q.id === r.quote_id)?.quote_no ?? null,
          user_email: db.profiles.find((p) => p.id === r.user_id)?.email ?? '',
        }))
    );
  }
  async assignQuoteDealer(id: string, dealerId: string | null, actor: SessionUser) {
    return this.mutate((db) => {
      if (actor.role !== 'admin') throw new StoreError('FORBIDDEN', '権限がありません');
      const q = db.quotes.find((x) => x.id === id);
      if (!q) throw new StoreError('NOT_FOUND', '見積が見つかりません');
      if (dealerId) {
        const p = db.profiles.find((x) => x.id === dealerId);
        if (!p || !hasRoleAtLeast(p.role_code, 'dealer')) {
          throw new StoreError('VALIDATION', '代理店以上の権限を持つユーザーを指定してください');
        }
      }
      const changed = q.dealer_id !== dealerId;
      q.dealer_id = dealerId;
      q.updated_at = nowIso();
      if (changed && dealerId) {
        this.pushNotification(db, {
          recipient_id: dealerId,
          audience: 'dealer',
          kind: 'quote_assigned',
          title: `別途工事の入力をお願いします：${q.quote_no}`,
          body: `${q.customer_name} 様の見積です。下のリンクを開くと、そのまま別途工事とフリー商品を入力できます。`,
          // メールから 1 回で入力表まで飛べるようにする
          link: `/admin/quotes/${q.id}?from=mail#quote-editor`,
        });
      }
      return q;
    });
  }

  async listDealerQuotes(dealerId: string) {
    return this.read((db) => {
      const email = new Map(db.profiles.map((p) => [p.id, p.email]));
      return db.quotes
        .filter((q) => q.dealer_id === dealerId)
        .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
        .map((q) => ({ ...q, user_email: email.get(q.user_id) ?? '' }));
    });
  }

  async createDealerRevision(id: string, input: DealerRevisionInput, actor: SessionUser) {
    return this.mutate((db) => {
      const parent = db.quotes.find((x) => x.id === id);
      if (!parent) throw new StoreError('NOT_FOUND', '見積が見つかりません');
      // 本体まで触れるのは総代理店以上。代理店は担当見積の別途工事とフリー商品だけ
      const full = hasRoleAtLeast(actor.role, 'master_dealer');
      if (!(full || (hasRoleAtLeast(actor.role, 'dealer') && parent.dealer_id === actor.id))) {
        throw new StoreError('FORBIDDEN', 'この見積を編集できる権限がありません');
      }
      if (parent.status === 'superseded') {
        throw new StoreError('LOCKED', 'この版はすでに改訂されています。最新の版から作成してください。');
      }
      for (const it of input.items) {
        if (!full && it.kind !== 'installation' && it.kind !== 'free') {
          throw new StoreError('FORBIDDEN', '本体・オプションを変更できるのは本部と総代理店だけです');
        }
        if (it.unit_price < 0 || it.quantity <= 0) throw new StoreError('VALIDATION', '金額・数量の入力が正しくありません');
      }

      // 本体内訳は 17.6㎡ のような小数の数量を持つ
      const amount = (it: DealerRevisionItem) => Math.round(it.unit_price * Math.max(0.01, it.quantity));
      const sumOf = (...kinds: DealerRevisionItem['kind'][]) =>
        input.items.filter((it) => kinds.includes(it.kind)).reduce((sum, it) => sum + amount(it), 0);
      const installation = sumOf('installation', 'free');
      // 本体・オプションの行が入力されていればそれを採用し、なければ元の版のまま
      const hasBase = input.items.some((it) => it.kind === 'base' || it.kind === 'base_expense');
      const hasOption = input.items.some((it) => it.kind === 'option' || it.kind === 'option_expense');
      const basePrice = hasBase ? sumOf('base') : parent.base_price;
      const baseExpense = hasBase ? sumOf('base_expense') : parent.base_expense;
      const optionSubtotal = hasOption ? sumOf('option') : parent.option_subtotal;
      const optionExpense = hasOption ? sumOf('option_expense') : parent.option_expense;
      const baseTotal = basePrice + baseExpense;
      const optionTotal = optionSubtotal + optionExpense;
      const subRaw = baseTotal + optionTotal + installation;
      const subtotal = Math.floor(subRaw / ROUNDING_UNIT) * ROUNDING_UNIT;
      const tax = Math.floor(subtotal * parent.tax_rate);
      const issued = new Date();

      const next: Quote = {
        ...parent,
        id: randomUUID(),
        quote_no: `${parent.quote_no}-${parent.revision + 1}`,
        status: 'issued',
        issued_at: issued.toISOString(),
        valid_until: addDays(issued, QUOTE_VALID_DAYS).toISOString(),
        base_price: basePrice,
        base_expense: baseExpense,
        option_subtotal: optionSubtotal,
        option_expense: optionExpense,
        installation_subtotal: installation,
        adjustment: subtotal - subRaw,
        subtotal,
        tax,
        total: subtotal + tax,
        notes: full
          ? '本見積書は最新の内容で作成した確定見積です。'
          : '本見積書は現地の代理店・工務店が別途工事を確認したうえで作成した確定見積です。',
        dealer_id: parent.dealer_id ?? (full ? null : actor.id),
        dealer_note: input.dealer_note,
        revision: parent.revision + 1,
        parent_quote_id: parent.id,
        created_at: issued.toISOString(),
        updated_at: issued.toISOString(),
      };
      db.quotes.push(next);

      // 入力がない区分は親の版から複製する（代理店が別途工事だけ直した場合など）
      const enteredKinds = new Set(input.items.map((it) => it.kind));
      const keepBase = !hasBase;
      const keepOption = !hasOption;
      for (const it of db.quoteItems.filter((x) => x.quote_id === parent.id)) {
        const isBase = it.kind === 'base' || it.kind === 'base_expense';
        const isOption = it.kind === 'option' || it.kind === 'option_expense';
        if ((isBase && keepBase) || (isOption && keepOption)) {
          db.quoteItems.push({ ...it, id: randomUUID(), quote_id: next.id });
        }
      }
      void enteredKinds;
      let sort = 1000;
      for (const it of input.items) {
        db.quoteItems.push({
          id: randomUUID(),
          quote_id: next.id,
          kind: it.kind,
          name: it.name || '（名称未設定）',
          description: it.description,
          unit: it.unit || '式',
          remark: it.remark,
          unit_price: it.unit_price,
          quantity: Math.max(0.01, it.quantity),
          amount: amount(it),
          image_url: it.image_url ?? null,
          sort_order: ++sort,
        });
      }

      this.pushNotification(db, {
        recipient_id: next.user_id,
        audience: 'customer',
        kind: 'quote_revised',
        title: `確定見積が届きました：${next.quote_no}`,
        body: `代理店が別途工事を確認し、第${next.revision}版の確定見積を発行しました。`,
        link: `/mypage/quotes/${next.id}`,
      });
      parent.status = 'superseded';
      parent.updated_at = nowIso();
      const req = db.quoteRequests.find((x) => x.id === parent.quote_request_id);
      if (req) {
        req.quote_id = next.id;
        req.status = 'sent';
        req.updated_at = nowIso();
      }
      return next;
    });
  }

  async updateQuoteStatus(id: string, status: QuoteStatus, requestStatus: QuoteRequestStatus | null) {
    this.mutate((db) => {
      const q = db.quotes.find((x) => x.id === id);
      if (!q) throw new StoreError('NOT_FOUND', '見積が見つかりません');
      q.status = status;
      q.updated_at = nowIso();
      if (requestStatus) {
        const r = db.quoteRequests.find((x) => x.id === q.quote_request_id);
        if (r) {
          r.status = requestStatus;
          r.updated_at = nowIso();
        }
      }
      const cfg = db.configurations.find((c) => c.id === q.configuration_id);
      if (cfg) {
        if (status === 'issued') cfg.status = 'quoted';
        if (status === 'accepted' || status === 'declined' || status === 'cancelled') cfg.status = 'closed';
      }
    });
  }

  // ---------- PDF ----------
  async getQuoteDocumentFile(quoteId: string) {
    return this.read((db) => {
      const doc = db.quoteDocuments.filter((d) => d.quote_id === quoteId).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
      if (!doc) return null;
      const p = path.join(filesDir(), doc.storage_path);
      if (!fs.existsSync(p)) return null;
      return { bytes: new Uint8Array(fs.readFileSync(p)), document: doc };
    });
  }
  async saveQuoteDocument(quoteId: string, bytes: Uint8Array, fileName: string) {
    return this.mutate((db) => {
      const rel = path.posix.join('quotes', `${quoteId}.pdf`);
      const abs = path.join(filesDir(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      const doc: QuoteDocument = {
        id: randomUUID(),
        quote_id: quoteId,
        storage_path: rel,
        file_name: fileName,
        byte_size: bytes.byteLength,
        generated_at: nowIso(),
      };
      db.quoteDocuments = db.quoteDocuments.filter((d) => d.quote_id !== quoteId);
      db.quoteDocuments.push(doc);
      return doc;
    });
  }

  // ---------- 管理 ----------
  async upsertModel(input: ModelInput): Promise<BaseModel> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      if (id) {
        const m = db.models.find((x) => x.id === id);
        if (!m) throw new StoreError('NOT_FOUND', 'モデルが見つかりません');
        Object.assign(m, rest, { updated_at: nowIso() });
        return m;
      }
      const m: BaseModel = { ...rest, id: randomUUID(), created_at: nowIso(), updated_at: nowIso() };
      db.models.push(m);
      return m;
    });
  }
  async listCategories() {
    return this.read((db) => [...db.categories].sort((a, b) => a.sort_order - b.sort_order));
  }
  async upsertCategory(input: CategoryInput): Promise<OptionCategory> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      if (id) {
        const c = db.categories.find((x) => x.id === id);
        if (!c) throw new StoreError('NOT_FOUND', 'カテゴリーが見つかりません');
        Object.assign(c, rest);
        return c;
      }
      const c: OptionCategory = { ...rest, id: randomUUID() };
      db.categories.push(c);
      return c;
    });
  }
  async upsertVariantGroup(input: OptionVariantGroup) {
    return this.mutate((db) => {
      const i = db.variantGroups.findIndex((g) => g.id === input.id);
      if (i >= 0) db.variantGroups[i] = { ...db.variantGroups[i], ...input };
      else db.variantGroups.push(input);
      return input;
    });
  }
  async upsertVariantChoice(input: OptionVariantChoice) {
    return this.mutate((db) => {
      const i = db.variantChoices.findIndex((c) => c.id === input.id);
      if (i >= 0) db.variantChoices[i] = { ...db.variantChoices[i], ...input };
      else db.variantChoices.push(input);
      return input;
    });
  }
  async applyCatalogImport(batch: CatalogImportBatch): Promise<void> {
    this.mutate((db) => {
      for (const input of batch.options) {
        const existing = db.options.find((o) => o.code === input.code);
        const { import_operation: _operation, ...optionInput } = input;
        if (existing) {
          const { id: _id, ...patch } = optionInput;
          Object.assign(existing, patch, { updated_at: nowIso() });
        } else {
          if (!optionInput.id) throw new StoreError('VALIDATION', `商品「${optionInput.code}」の ID がありません`);
          db.options.push({ ...optionInput, id: optionInput.id, created_at: nowIso(), updated_at: nowIso() });
        }
      }
      for (const input of batch.variantGroups) {
        if (!db.options.some((o) => o.id === input.option_id)) {
          throw new StoreError('VALIDATION', `選択項目「${input.code}」の商品が見つかりません`);
        }
        if (db.variantGroups.some((g) => g.option_id === input.option_id && g.code === input.code && g.id !== input.id)) {
          throw new StoreError('VALIDATION', `選択項目コード「${input.code}」は既に使われています`);
        }
        const i = db.variantGroups.findIndex((g) => g.id === input.id);
        if (i >= 0) db.variantGroups[i] = { ...db.variantGroups[i], ...input };
        else db.variantGroups.push(input);
      }
      for (const input of batch.variantChoices) {
        if (!db.variantGroups.some((g) => g.id === input.group_id)) {
          throw new StoreError('VALIDATION', `選択肢「${input.code}」の選択項目が見つかりません`);
        }
        if (db.variantChoices.some((c) => c.group_id === input.group_id && c.code === input.code && c.id !== input.id)) {
          throw new StoreError('VALIDATION', `選択肢コード「${input.code}」は既に使われています`);
        }
        const i = db.variantChoices.findIndex((c) => c.id === input.id);
        if (i >= 0) db.variantChoices[i] = { ...db.variantChoices[i], ...input };
        else db.variantChoices.push(input);
      }
    });
  }
  async listOptions() {
    return this.read((db) => [...db.options].sort((a, b) => a.sort_order - b.sort_order));
  }
  async getOption(id: string) {
    return this.read((db) => db.options.find((o) => o.id === id) ?? null);
  }
  async upsertOption(input: OptionInput): Promise<ProductOption> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      if (db.options.some((o) => o.code === rest.code && o.id !== id)) {
        throw new StoreError('VALIDATION', `コード「${rest.code}」は既に使われています`);
      }
      if (id) {
        const o = db.options.find((x) => x.id === id);
        if (!o) {
          const created: ProductOption = { ...rest, id, created_at: nowIso(), updated_at: nowIso() };
          db.options.push(created);
          this.pushAudit(db, null, { action: 'create', entity: 'option', entity_id: created.id, summary: `商品を追加：${created.name}` });
          return created;
        }
        const before = { price: o.price, status: o.status };
        Object.assign(o, rest, { updated_at: nowIso() });
        if (before.price !== o.price) {
          this.pushAudit(db, null, {
            action: 'price',
            entity: 'option',
            entity_id: o.id,
            summary: `価格を変更：${o.name}（${before.price} → ${o.price} 円）`,
          });
        }
        if (before.status !== o.status) {
          this.pushAudit(db, null, {
            action: 'status',
            entity: 'option',
            entity_id: o.id,
            summary: `公開状態を変更：${o.name}（${before.status} → ${o.status}）`,
          });
        }
        return o;
      }
      const o: ProductOption = { ...rest, id: randomUUID(), created_at: nowIso(), updated_at: nowIso() };
      db.options.push(o);
      this.pushAudit(db, null, { action: 'create', entity: 'option', entity_id: o.id, summary: `商品を追加：${o.name}` });
      return o;
    });
  }
  async deleteOption(id: string) {
    this.mutate((db) => {
      if (db.configurationItems.some((i) => i.option_id === id)) {
        throw new StoreError('VALIDATION', '保存済みの仕様で使用されているため削除できません。非公開にしてください。');
      }
      db.options = db.options.filter((o) => o.id !== id);
      db.dependencies = db.dependencies.filter((d) => d.option_id !== id && d.requires_option_id !== id);
      db.conflicts = db.conflicts.filter((c) => c.option_id !== id && c.conflicts_with_option_id !== id);
    });
  }
  async setOptionRelations(
    optionId: string,
    dependencies: { requires_option_id: string; message: string | null }[],
    conflicts: { conflicts_with_option_id: string; message: string | null }[]
  ) {
    this.mutate((db) => {
      db.dependencies = db.dependencies.filter((d) => d.option_id !== optionId);
      db.conflicts = db.conflicts.filter((c) => c.option_id !== optionId);
      for (const d of dependencies) db.dependencies.push({ id: randomUUID(), option_id: optionId, ...d });
      for (const c of conflicts) db.conflicts.push({ id: randomUUID(), option_id: optionId, ...c });
    });
  }
  async upsertPreviewRule(input: PreviewRuleInput): Promise<PreviewImageRule> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      if (id) {
        const r = db.previewRules.find((x) => x.id === id);
        if (!r) throw new StoreError('NOT_FOUND', 'ルールが見つかりません');
        Object.assign(r, rest);
        return r;
      }
      const r: PreviewImageRule = { ...rest, id: randomUUID() };
      db.previewRules.push(r);
      return r;
    });
  }
  async deletePreviewRule(id: string) {
    this.mutate((db) => {
      db.previewRules = db.previewRules.filter((r) => r.id !== id);
      db.hotspots = db.hotspots.filter((h) => h.rule_id !== id);
    });
  }
  async upsertHotspot(input: HotspotInput): Promise<PreviewHotspot> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      if (id) {
        const h = db.hotspots.find((x) => x.id === id);
        if (!h) throw new StoreError('NOT_FOUND', 'クリック領域が見つかりません');
        Object.assign(h, rest);
        return h;
      }
      const h: PreviewHotspot = { ...rest, id: randomUUID() };
      db.hotspots.push(h);
      return h;
    });
  }
  async deleteHotspot(id: string) {
    this.mutate((db) => {
      db.hotspots = db.hotspots.filter((h) => h.id !== id);
    });
  }
  async addProductImage(input: ProductImageInput): Promise<ProductImage> {
    return this.mutate((db) => {
      const { id, ...rest } = input;
      const img: ProductImage = { ...rest, id: id ?? randomUUID() };
      db.images.push(img);
      return img;
    });
  }
  async deleteProductImage(id: string) {
    this.mutate((db) => {
      db.images = db.images.filter((i) => i.id !== id);
    });
  }
  // ---------- お問い合わせ ----------
  async createContactMessage(input: ContactInput): Promise<ContactMessage> {
    let attachment_path: string | null = null;
    if (input.attachment) {
      const ext = path.extname(input.attachment.fileName).toLowerCase() || '.bin';
      const rel = path.posix.join('contact', `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
      const abs = path.join(filesDir(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, input.attachment.bytes);
      attachment_path = rel;
    }
    return this.mutate((db) => {
      const row: ContactMessage = {
        id: randomUUID(),
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        topic: input.topic,
        message: input.message,
        attachment_path,
        attachment_name: input.attachment?.fileName ?? null,
        status: 'new',
        created_at: nowIso(),
      };
      db.contactMessages.push(row);
      this.pushNotification(db, {
        recipient_id: null,
        audience: 'admin',
        kind: 'contact_received',
        title: `新しいお問い合わせ：${row.topic ?? 'その他'}`,
        body: `${row.full_name} 様（${row.email}）`,
        link: '/admin/contacts',
      });
      return row;
    });
  }
  async listContactMessages() {
    return this.read((db) => [...db.contactMessages].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  async updateContactStatus(id: string, status: ContactStatus) {
    this.mutate((db) => {
      const m = db.contactMessages.find((x) => x.id === id);
      if (!m) throw new StoreError('NOT_FOUND', 'お問い合わせが見つかりません');
      m.status = status;
    });
  }

  async uploadImage(file: UploadInput, folder: string) {
    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '') || 'uploads';
    const ext = path.extname(file.fileName).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const abs = path.join(filesDir(), safeFolder, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.bytes);
    return `/api/local-files/${safeFolder}/${name}`;
  }
  async uploadCatalogImportImage(file: UploadInput, userId: string, sessionId: string, index: number) {
    const storagePath = catalogImportUploadPath(userId, sessionId, index, file.fileName);
    const abs = path.join(filesDir(), ...storagePath.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.bytes);
    return localCatalogImportUrl(storagePath);
  }
  async deleteUploadedImage(url: string) {
    const prefix = '/api/local-files/';
    if (!url.startsWith(prefix)) return;
    const relative = url.slice(prefix.length);
    const root = path.resolve(filesDir());
    const target = path.resolve(root, relative);
    if (target !== root && target.startsWith(`${root}${path.sep}`)) fs.rmSync(target, { force: true });
  }
  async listReferencedCatalogImportImageUrls(userId: string) {
    return this.read((db) =>
      catalogImportUrlsForUser(
        [
          ...db.options.map((option) => option.image_url),
          ...db.variantChoices.map((choice) => choice.image_url),
        ],
        userId
      )
    );
  }
  async deleteUnreferencedCatalogImportImages(candidateUrls: string[], userId: string) {
    const candidates = catalogImportPathsForUser(candidateUrls, userId);
    if (!candidates.length) return 0;
    const referenced = new Set(catalogImportPathsForUser(await this.listReferencedCatalogImportImageUrls(userId), userId));
    const root = path.resolve(filesDir());
    let deleted = 0;
    for (const storagePath of candidates) {
      if (referenced.has(storagePath)) continue;
      const target = path.resolve(root, ...storagePath.split('/'));
      if (target === root || !target.startsWith(`${root}${path.sep}`)) continue;
      fs.rmSync(target, { force: true });
      deleted++;
    }
    return deleted;
  }
}
