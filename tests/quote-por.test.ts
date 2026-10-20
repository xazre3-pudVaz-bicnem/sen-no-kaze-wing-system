import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import {
  UNRESOLVED_POR_LINES_MESSAGE,
  configurationPorSelections,
  isUnresolvedPorLine,
  porSelectionLabel,
  samePorSelectionKeys,
  unconfirmedPorSelectionsError,
  unresolvedPorLinesError,
  type PorSelectionCatalog,
} from '@/lib/domain/quote-por';
import type { Configuration, ConfigurationItem, Quote, QuoteItem, QuoteRequest } from '@/lib/domain/types';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016111000_quote_formal_por_guard.sql'), 'utf8');

describe('未解決の別途見積（POR）の行（SQL の quote_line_is_unresolved_por と同じ決まり）', () => {
  it('実 DB の検査（QPG-1）と同じ 12 通りで同じ結果になる', () => {
    const cases: [Parameters<typeof isUnresolvedPorLine>[0], boolean][] = [
      [{ unit_price: 0, description: '設置場所確認後に別途お見積り', remark: null }, true],
      [{ unit_price: 0, description: '設置場所確認後に別途お見積り', remark: '電気設備工事に含む' }, false],
      [{ unit_price: 5000, description: '設置場所確認後に別途お見積り', remark: null }, false],
      [{ unit_price: 0, description: null, remark: '別途見積' }, true],
      [{ unit_price: 0, description: null, remark: ' 別途見積 ' }, true],
      [{ unit_price: 0, description: null, remark: '価格未確定（別途お見積り）' }, true],
      [{ unit_price: 0, description: null, remark: '別途見積項目あり・見積発行時点の面別外壁仕様' }, true],
      [{ unit_price: 1000, description: null, remark: '別途見積項目あり・見積発行時点の面別外壁仕様' }, false],
      [{ unit_price: 0, description: null, remark: null, optionIsPor: true }, true],
      [{ unit_price: 0, description: null, remark: 'サービス', optionIsPor: true }, false],
      [{ unit_price: 0, description: null, remark: null, optionIsPor: false }, false],
      [{ unit_price: 0, description: null, remark: null }, false],
    ];
    expect(cases.map(([line]) => isUnresolvedPorLine(line))).toEqual(cases.map(([, expected]) => expected));
  });

  it('前後の空白は SQL の btrim と同じく半角スペースだけを取り除く', () => {
    expect(isUnresolvedPorLine({ unit_price: 0, remark: '  別途見積' })).toBe(true);
    // 全角スペースは取り除かない（SQL と同じ）。備考が空ではないので理由ありとみなす
    expect(isUnresolvedPorLine({ unit_price: 0, remark: '　別途見積' })).toBe(false);
    expect(isUnresolvedPorLine({ unit_price: 0, description: ' 設置場所確認後に別途お見積り ', remark: '  ' })).toBe(true);
  });

  it('目印の文言は migration と同じ', () => {
    expect(migration).toContain(`btrim(coalesce(p_remark, '')) in ('別途見積', '価格未確定（別途お見積り）')`);
    expect(migration).toContain(`btrim(coalesce(p_remark, '')) like '別途見積項目あり%'`);
    expect(migration).toContain(`btrim(coalesce(p_description, '')) = '設置場所確認後に別途お見積り'`);
  });

  it('止めたときの文面は DB と同じ', () => {
    expect(migration).toContain(`別途見積（価格未確定）の明細が % 行残っています（%）。${UNRESOLVED_POR_LINES_MESSAGE}`);
    expect(migration).toContain(`別途見積（価格未確定）の明細が % 行残っています（%）。${UNRESOLVED_POR_LINES_MESSAGE.replace('発行してください', '正式保存してください')}`);
    expect(unresolvedPorLinesError(['照明', 'テーブル'])).toBe(`別途見積（価格未確定）の明細が 2 行残っています（照明、テーブル）。${UNRESOLVED_POR_LINES_MESSAGE}`);
    expect(unresolvedPorLinesError(['照明'], '正式保存')).toMatch(/明細から外してから正式保存してください$/);
    expect(unconfirmedPorSelectionsError([{ key: 'product:x', option_id: 'x', name: '照明', detail: null }])).toBe(
      'お客様が選んだ別途見積の商品（1 件：照明）について、金額を明細に入れたか、お客様と合意のうえ対象外にしたことの確認が済んでいません。画面の「別途見積の確認」で確認してから発行してください'
    );
    expect(migration).toContain('について、金額を明細に入れたか、お客様と合意のうえ対象外にしたことの確認が済んでいません。画面の「別途見積の確認」で確認してから発行してください');
  });
});

describe('お客様が選んだ別途見積の商品（SQL の configuration_por_selections と同じ）', () => {
  const catalog: PorSelectionCatalog = {
    options: [
      { id: 'o-por', name: '検査の別途見積の商品', category_id: 'c-items', price_on_request: true, sort_order: 1 },
      { id: 'o-plain', name: '検査の通常の商品', category_id: 'c-items', price_on_request: false, sort_order: 2 },
      { id: 'o-ext', name: '検査の外壁', category_id: 'c-ext', price_on_request: false, sort_order: 1 },
      { id: 'o-ext-por', name: '別途見積の外壁', category_id: 'c-ext', price_on_request: true, sort_order: 2 },
    ],
    categories: [
      { id: 'c-items', code: 'runtime-qpg-items', sort_order: 1 },
      { id: 'c-ext', code: 'exterior-wall', sort_order: 0 },
    ],
    variantGroups: [
      { id: 'g-plain', option_id: 'o-plain', name: '色', sort_order: 1 },
      { id: 'g-ext', option_id: 'o-ext', name: '塗装', sort_order: 1 },
    ],
    variantChoices: [
      { id: 'vc-plain', group_id: 'g-plain', name: '白', price_on_request: false, sort_order: 1 },
      { id: 'vc-por', group_id: 'g-plain', name: '特注色', price_on_request: true, sort_order: 2 },
      { id: 'e-plain', group_id: 'g-ext', name: '標準', price_on_request: false, sort_order: 1 },
      { id: 'e-por', group_id: 'g-ext', name: '特注塗装', price_on_request: true, sort_order: 2 },
    ],
  };
  const faces = [
    { face_code: 'front' as const, option_id: 'o-ext', variant_choice_ids: ['e-por'] },
    { face_code: 'right' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
    { face_code: 'back' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
    { face_code: 'left' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
  ];

  it('商品・選択肢・外壁の面の順に並べ、外壁を面で選んだときの外壁の商品の明細は面として数える（実 DB の検査 QPG-2 と同じ）', () => {
    const selections = configurationPorSelections(
      {
        items: [
          { option_id: 'o-plain', variant_choice_ids: ['vc-por'] },
          { option_id: 'o-por', variant_choice_ids: [] },
          { option_id: 'o-ext-por', variant_choice_ids: [] },
        ],
        exteriorFaces: faces,
      },
      catalog
    );
    expect(selections.map((s) => `${s.key}|${s.name}|${s.detail ?? ''}`)).toEqual([
      'product:o-por|検査の別途見積の商品|',
      'variant:o-plain:vc-por|検査の通常の商品|色：特注色',
      'face:front:o-ext|検査の外壁|外壁（正面）：塗装：特注塗装',
    ]);
    expect(selections.map(porSelectionLabel)).toEqual(['検査の別途見積の商品', '検査の通常の商品（色：特注色）', '検査の外壁（外壁（正面）：塗装：特注塗装）']);
  });

  it('面を選んでいない構成では、外壁の商品も商品として数える。別途見積を選んでいなければ空', () => {
    expect(configurationPorSelections({ items: [{ option_id: 'o-ext-por' }] }, catalog).map((s) => s.key)).toEqual(['product:o-ext-por']);
    expect(configurationPorSelections({ items: [{ option_id: 'o-plain', variant_choice_ids: ['vc-plain'] }] }, catalog)).toEqual([]);
    // ほかの商品の選択肢は数えない
    expect(configurationPorSelections({ items: [{ option_id: 'o-por', variant_choice_ids: ['e-por'] }] }, catalog).map((s) => s.key)).toEqual(['product:o-por']);
  });

  it('画面に出した一覧と今の一覧の比べ方は、順番・重複を問わない', () => {
    const current = [
      { key: 'b', option_id: 'x', name: 'x', detail: null },
      { key: 'a', option_id: 'x', name: 'x', detail: null },
    ];
    expect(samePorSelectionKeys(['a', 'b'], current)).toBe(true);
    expect(samePorSelectionKeys(['b', 'a', 'a'], current)).toBe(true);
    expect(samePorSelectionKeys(['a'], current)).toBe(false);
    expect(samePorSelectionKeys(['a', 'b', 'c'], current)).toBe(false);
  });
});

describe('ローカル検証モードの改訂（確定見積）でも同じ止めをする', () => {
  let dir = '';
  const dealer = { id: 'dealer-por', email: 'dealer-por@example.test', role: 'dealer' } as SessionUser;
  const otherDealer = { id: 'dealer-other', email: 'other@example.test', role: 'dealer' } as SessionUser;
  const admin = { id: 'admin-por', email: 'admin-por@example.test', role: 'admin' } as SessionUser;
  const customerId = 'customer-por';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-quote-por-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 照明（別途見積の商品）を選んだ Web の案件と、その概算（第 1 版） */
  function seed() {
    const db = loadDb();
    const lighting = db.options.find((option) => option.price_on_request);
    if (!lighting) throw new Error('初期データに別途見積の商品がありません');
    const now = '2026-10-20T00:00:00.000Z';
    const cfg = {
      id: 'cfg-por',
      user_id: customerId,
      base_model_id: db.models[0].id,
      name: 'POR の案件',
      status: 'quote_requested',
      spec_code: null,
      finish_level: 'full',
      lock_version: 1,
      created_at: now,
      updated_at: now,
    } as unknown as Configuration;
    const item: ConfigurationItem = { id: 'ci-por', configuration_id: cfg.id, option_id: lighting.id, quantity: 1, variant_choice_ids: [] };
    const quote = {
      id: 'q-por-1',
      quote_no: 'Q-POR-1',
      quote_request_id: 'req-por',
      configuration_id: cfg.id,
      user_id: customerId,
      status: 'issued',
      issued_at: now,
      valid_until: now,
      customer_no: null,
      customer_name: 'お客様',
      customer_company: null,
      base_model_name: 'Wing',
      finish_level: 'full',
      base_price: 1_000_000,
      base_expense: 0,
      option_subtotal: 0,
      option_expense: 0,
      installation_subtotal: 0,
      adjustment: 0,
      subtotal: 1_000_000,
      tax_rate: 0.1,
      tax: 100_000,
      total: 1_100_000,
      dealer_id: dealer.id,
      dealer_note: null,
      revision: 1,
      parent_quote_id: null,
      preview_image_url: null,
      notes: null,
      created_at: now,
      updated_at: now,
    } as Quote;
    const lines: QuoteItem[] = [
      { id: 'qi-base', quote_id: quote.id, kind: 'base', name: '本体一式', description: null, unit: '式', remark: null, unit_price: 1_000_000, quantity: 1, amount: 1_000_000, image_url: null, sort_order: 0 },
      { id: 'qi-light', quote_id: quote.id, kind: 'option', name: lighting.name, description: '設置場所確認後に別途お見積り', unit: '式', remark: null, unit_price: 0, quantity: 1, amount: 0, image_url: null, sort_order: 1000 },
    ];
    const request = {
      id: 'req-por',
      configuration_id: cfg.id,
      user_id: customerId,
      quote_id: quote.id,
      status: 'sent',
      message: null,
      contact: { full_name: 'お客様', company_name: null, email: 'c@example.test', phone: '', address: '', site_address: null },
      created_at: now,
      updated_at: now,
    } as QuoteRequest;
    db.configurations.push(cfg);
    db.configurationItems.push(item);
    db.quotes.push(quote);
    db.quoteItems.push(...lines);
    db.quoteRequests.push(request);
    saveDb(db);
    return { lighting, quote };
  }

  const items = (lightingName: string, lighting: { unit_price: number; remark: string | null }) => [
    { kind: 'option' as const, name: lightingName, description: '設置場所確認後に別途お見積り', unit: '式', remark: lighting.remark, unit_price: lighting.unit_price, quantity: 1 },
    { kind: 'installation' as const, name: '電気設備工事', description: null, unit: '式', remark: null, unit_price: 80_000, quantity: 1 },
  ];

  it('一覧は本部と担当の代理店だけが取れ、確認の前は未確認', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    await expect(store.getQuotePorSelections(quote.id, otherDealer)).rejects.toThrow('別途見積を確認できません');
    const state = await store.getQuotePorSelections(quote.id, dealer);
    expect(state).toEqual({ selections: [{ key: `product:${lighting.id}`, option_id: lighting.id, name: lighting.name, detail: null }], confirmed: false, available: true });
    expect((await store.getQuotePorSelections(quote.id, admin)).selections).toHaveLength(1);
  });

  it('POR の行を 0 円のまま残すと発行しない。止めた発行では何も変わらない', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: null }), dealer_note: null, por_confirmation_keys: [`product:${lighting.id}`] }, dealer)
    ).rejects.toThrow('別途見積（価格未確定）の明細が 1 行残っています');
    const db = loadDb();
    expect(db.quotes.filter((row) => row.quote_request_id === 'req-por')).toHaveLength(1);
    expect(db.quotes.find((row) => row.id === quote.id)?.status).toBe('issued');
    // 確認の記録は発行とは別に残る（DB と同じ）
    expect(db.quotePorConfirmations ?? []).toHaveLength(1);
  });

  it('理由の備考を書いても、担当者の確認がなければ発行しない。一覧が違えば確認を記録しない', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: '電気設備工事に含む' }), dealer_note: null }, dealer)
    ).rejects.toThrow('お客様が選んだ別途見積の商品（1 件');
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: '電気設備工事に含む' }), dealer_note: null, por_confirmation_keys: ['product:other'] }, dealer)
    ).rejects.toThrow('画面を開いた後に変わりました');
    expect(loadDb().quotePorConfirmations ?? []).toHaveLength(0);
  });

  it('本部の確認は担当代理店の確認の代わりにならない。担当代理店が確認すれば発行でき、確認は版ごと', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    const keys = [`product:${lighting.id}`];
    const resolved = items(lighting.name, { unit_price: 0, remark: '電気設備工事に含む' });
    // 本部が確認だけを記録しても（発行は理由なしの 0 円で止まる）、担当代理店の発行には使えない
    await expect(store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: null }), dealer_note: null, por_confirmation_keys: keys }, admin)).rejects.toThrow('残っています');
    await expect(store.createDealerRevision(quote.id, { items: resolved, dealer_note: null }, dealer)).rejects.toThrow('お客様が選んだ別途見積の商品');

    const next = await store.createDealerRevision(quote.id, { items: resolved, dealer_note: null, por_confirmation_keys: keys }, dealer);
    expect(next.revision).toBe(2);
    const db = loadDb();
    expect(db.quotes.find((row) => row.id === quote.id)?.status).toBe('superseded');
    expect(db.quoteRequests.find((row) => row.id === 'req-por')?.quote_id).toBe(next.id);
    expect((db.quotePorConfirmations ?? []).map((row) => row.confirmed_by).sort()).toEqual([admin.id, dealer.id].sort());
    expect((await store.getQuotePorSelections(next.id, dealer)).confirmed).toBe(false);
  });

  it('同じ担当者が同じ一覧を何度確認しても、記録は 1 つ', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    const keys = [`product:${lighting.id}`];
    const unresolved = items(lighting.name, { unit_price: 0, remark: null });
    await expect(store.createDealerRevision(quote.id, { items: unresolved, dealer_note: null, por_confirmation_keys: keys }, dealer)).rejects.toThrow();
    await expect(store.createDealerRevision(quote.id, { items: unresolved, dealer_note: null, por_confirmation_keys: keys }, dealer)).rejects.toThrow();
    expect(loadDb().quotePorConfirmations ?? []).toHaveLength(1);
    expect((await store.getQuotePorSelections(quote.id, dealer)).confirmed).toBe(true);
  });
});
