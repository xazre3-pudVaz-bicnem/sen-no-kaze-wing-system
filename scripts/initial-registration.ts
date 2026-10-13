/**
 * 初期登録（統合版依頼書 §11）：確定資料 xlsx の 10 組み合わせを、本体マスター → 標準見積の順に RPC で登録する。
 *
 *   計画だけ（既定。DB へは書かない）
 *     node scripts/initial-registration.ts [--xlsx <path>]
 *   使い捨て DB（リハーサル）へ登録
 *     node scripts/initial-registration.ts --apply --db-url postgresql://... --actor <本部の利用者の profile id>
 *   本番へ登録（本番 migration 適用後・ユーザーの承認後だけ。本部の管理者でログインして RPC を呼ぶ）
 *     node scripts/initial-registration.ts --apply --supabase --yes-production
 *       （.env.local の NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / WING_REGISTRATION_EMAIL / WING_REGISTRATION_PASSWORD）
 *
 * - 計画は .wing-local/initial-registration-plan.json に書き出す（原価を含むため、公開リポジトリへ commit しない）
 * - 登録は RPC だけで行い、DB の検査（権限・identity・率・trunc）をすべて通す。表への直接の書き込みはしない
 * - すでに登録済みの組み合わせ（有効な本体マスター・公開中の標準見積がある）は飛ばす。作り直しや上書きはしない
 * - 登録後、DB が計算した金額が計画（画面の試算と同じ式）と一致することを確かめ、違えば失敗にする
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { arg, loadEnv, requireEnv } from './env.ts';
import { readXlsx } from './lib/read-xlsx.ts';
import { buildRegistrationPlan, type PlanCombo, type RegistrationPlan } from './initial-registration/plan.ts';

const DEFAULT_XLSX = 'assets/source-docs/標準見積_初期登録候補整理_初期登録確認完了_20261008.xlsx';
const PLAN_OUT = '.wing-local/initial-registration-plan.json';

interface Ops {
  modelId(slug: string): Promise<string>;
  matrixRowId(modelId: string, spec: string, size: string): Promise<string>;
  headquartersId(): Promise<string>;
  activeBaseMaster(orgId: string, rowId: string, fire: string): Promise<{ id: string; current_published_revision_id: string | null } | null>;
  standardEstimateMaster(orgId: string, baseMasterId: string, spec: string): Promise<{ id: string; current_published_revision_id: string | null } | null>;
  /** 途中で止まった登録の続き用：本体マスター・標準見積の下書き */
  baseDraft(baseMasterId: string): Promise<{ id: string } | null>;
  estimateDraft(masterId: string): Promise<{ id: string; lock_version: number } | null>;
  revisionMoney(revisionId: string): Promise<{ subtotal: number; tax: number; total: number; cost_total: number }>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function pgOps(dbUrl: string, actor: string): Ops {
  const client = new pg.Client({ connectionString: dbUrl });
  const ready = client.connect();
  const one = async <T>(sql: string, params: unknown[]): Promise<T | null> => {
    await ready;
    return ((await client.query(sql, params)).rows[0] as T | undefined) ?? null;
  };
  const must = async (sql: string, params: unknown[], what: string): Promise<string> => {
    const row = await one<{ id: string }>(sql, params);
    if (!row) throw new Error(`${what}が見つかりません`);
    return row.id;
  };
  return {
    modelId: (slug) => must('select id from public.base_models where slug = $1', [slug], `機種 ${slug} `),
    matrixRowId: (modelId, spec, size) =>
      must(`select id from public.matrix_rows where base_model_id = $1 and spec_code = $2 and size_code = $3 and status = 'active'`, [modelId, spec, size], `マトリクスの行 ${spec}/${size} `),
    headquartersId: () => must(`select id from public.organizations where organization_type = 'headquarters' and status = 'active'`, [], '本部の組織'),
    activeBaseMaster: (orgId, rowId, fire) =>
      one(`select id, current_published_revision_id from public.base_masters where owner_organization_id = $1 and matrix_row_id = $2 and fire_spec_code = $3 and status = 'active'`, [orgId, rowId, fire]),
    standardEstimateMaster: (orgId, baseMasterId, spec) =>
      one(`select id, current_published_revision_id from public.standard_estimate_masters where owner_organization_id = $1 and base_master_id = $2 and spec_code = $3`, [orgId, baseMasterId, spec]),
    baseDraft: (baseMasterId) =>
      one(`select id from public.base_master_revisions where base_master_id = $1 and status = 'draft' order by version desc limit 1`, [baseMasterId]),
    estimateDraft: (masterId) =>
      one(`select id, lock_version from public.standard_estimate_revisions where standard_estimate_master_id = $1 and status = 'draft' order by version desc limit 1`, [masterId]),
    revisionMoney: async (revisionId) => {
      const row = await one<{ subtotal: number; tax: number; total: number; cost_total: number }>(
        'select subtotal, tax, total, cost_total from public.standard_estimate_revisions where id = $1',
        [revisionId]
      );
      if (!row) throw new Error('標準見積の Revision が見つかりません');
      return row;
    },
    rpc: async (name, args) => {
      await ready;
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) as result`;
      await client.query('begin');
      try {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: actor })]);
        await client.query('set local role authenticated');
        // node-postgres は配列を Postgres の配列へ変換するため、jsonb の引数（配列・オブジェクト）は JSON 文字列で渡す
        const values = keys.map((key) => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
        const result = (await client.query(sql, values)).rows[0]?.result;
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    },
    close: async () => {
      await ready;
      await client.end();
    },
  };
}

async function supabaseOps(): Promise<Ops> {
  const db = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({
    email: requireEnv('WING_REGISTRATION_EMAIL'),
    password: requireEnv('WING_REGISTRATION_PASSWORD'),
  });
  if (signInError) throw new Error(`本部の管理者でログインできません: ${signInError.message}`);
  const single = async <T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string, required = true): Promise<T | null> => {
    const { data, error } = await promise;
    if (error) throw new Error(`${what}: ${error.message}`);
    if (!data && required) throw new Error(`${what}が見つかりません`);
    return data;
  };
  return {
    modelId: async (slug) => (await single(db.from('base_models').select('id').eq('slug', slug).maybeSingle(), `機種 ${slug}`))!.id as string,
    matrixRowId: async (modelId, spec, size) =>
      (await single(db.from('matrix_rows').select('id').eq('base_model_id', modelId).eq('spec_code', spec).eq('size_code', size).eq('status', 'active').maybeSingle(), `マトリクスの行 ${spec}/${size}`))!.id as string,
    headquartersId: async () =>
      (await single(db.from('organizations').select('id').eq('organization_type', 'headquarters').eq('status', 'active').maybeSingle(), '本部の組織'))!.id as string,
    activeBaseMaster: (orgId, rowId, fire) =>
      single(db.from('base_masters').select('id, current_published_revision_id').eq('owner_organization_id', orgId).eq('matrix_row_id', rowId).eq('fire_spec_code', fire).eq('status', 'active').maybeSingle(), '本体マスター', false),
    standardEstimateMaster: (orgId, baseMasterId, spec) =>
      single(db.from('standard_estimate_masters').select('id, current_published_revision_id').eq('owner_organization_id', orgId).eq('base_master_id', baseMasterId).eq('spec_code', spec).maybeSingle(), '標準見積', false),
    baseDraft: (baseMasterId) =>
      single(db.from('base_master_revisions').select('id').eq('base_master_id', baseMasterId).eq('status', 'draft').order('version', { ascending: false }).limit(1).maybeSingle(), '本体の下書き', false),
    estimateDraft: (masterId) =>
      single(db.from('standard_estimate_revisions').select('id, lock_version').eq('standard_estimate_master_id', masterId).eq('status', 'draft').order('version', { ascending: false }).limit(1).maybeSingle(), '標準見積の下書き', false),
    revisionMoney: async (revisionId) =>
      (await single(db.from('standard_estimate_revisions').select('subtotal, tax, total, cost_total').eq('id', revisionId).maybeSingle(), '標準見積の Revision'))!,
    rpc: async (name, args) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return data;
    },
    close: async () => {
      await db.auth.signOut();
    },
  };
}

const idOf = (value: unknown) => (typeof value === 'string' ? value : (value as { id?: string } | null)?.id ?? null);

async function registerCombo(ops: Ops, combo: PlanCombo, plan: RegistrationPlan): Promise<string> {
  const orgId = await ops.headquartersId();
  const modelId = await ops.modelId(combo.model_slug);
  const rowId = await ops.matrixRowId(modelId, combo.spec_code, combo.size_code);
  const name = combo.label;

  let base = await ops.activeBaseMaster(orgId, rowId, combo.fire_spec_code);
  let baseRevisionId = base?.current_published_revision_id ?? null;
  if (!baseRevisionId) {
    // 途中で止まった登録の続き：公開版の無い本体マスターは、その下書きへ保存して公開する（公開済みは上書きしない）
    const resumed = base ? (await ops.baseDraft(base.id))?.id ?? null : null;
    if (base && !resumed) throw new Error(`${name}: 公開版も下書きも無い本体マスターがあります（管理画面で確認してください）`);
    const draft = resumed ?? idOf(await ops.rpc('create_base_master_draft', {
      p_base_model_id: modelId,
      p_owner_organization_id: orgId,
      p_name: name,
      p_fire_spec_code: combo.fire_spec_code,
      p_cloned_from_revision_id: null,
      p_matrix_row_id: rowId,
    }));
    if (!draft) throw new Error(`${name}: 本体マスターの下書きを作れませんでした`);
    await ops.rpc('save_base_master_draft', {
      p_revision_id: draft,
      p_name: name,
      p_fire_spec_code: combo.fire_spec_code,
      // 本体マスターは構造・直接原価だけ。本体諸費用は標準見積の経費率で計算する
      p_expense_method: 'none',
      p_expense_rate: null,
      p_expense_amount: 0,
      p_lines: combo.base_lines.map((line) => ({ section: line.section, name: line.name, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price })),
    });
    await ops.rpc('publish_base_master_draft', { p_revision_id: draft });
    baseRevisionId = draft;
    base = await ops.activeBaseMaster(orgId, rowId, combo.fire_spec_code);
  }

  const existing = await ops.standardEstimateMaster(orgId, base!.id, combo.spec_code);
  if (existing?.current_published_revision_id) return `済（既存の公開版を確認）${await verify(ops, combo, existing.current_published_revision_id)}`;

  const leftover = existing ? await ops.estimateDraft(existing.id) : null;
  const estimate = leftover?.id ?? idOf(await ops.rpc('create_standard_estimate_draft', { p_base_master_revision_id: baseRevisionId, p_name: name }));
  if (!estimate) throw new Error(`${name}: 標準見積の下書きを作れませんでした`);
  const lockVersion = leftover?.lock_version ?? 1;
  await ops.rpc('save_standard_estimate_draft', {
    p_revision_id: estimate,
    p_sales_fee_rate: plan.rates.salesFeeRate,
    p_expense_rate: plan.rates.expenseRate,
    p_markup_rate: plan.rates.markupRate,
    p_adjustment: 0,
    p_adjustment_reason: null,
    p_section_methods: { base: 'rate', interior_exterior: 'rate', option: 'rate', sitework: 'none' },
    p_lines: combo.estimate_lines.map((line) => ({
      section_code: line.section_code,
      group_label: line.group_label,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      price_mode: line.price_mode,
      cost_unit_price: line.cost_unit_price,
      remark: line.remark,
    })),
    p_expected_lock_version: lockVersion,
  });
  await ops.rpc('publish_standard_estimate_revision', { p_revision_id: estimate, p_expected_lock_version: lockVersion + 1 });
  return `登録 ${await verify(ops, combo, estimate)}`;
}

async function verify(ops: Ops, combo: PlanCombo, revisionId: string): Promise<string> {
  const money = await ops.revisionMoney(revisionId);
  const expected = combo.expected;
  if (money.subtotal !== expected.subtotal || money.tax !== expected.tax || money.total !== expected.total || money.cost_total !== expected.cost_total) {
    throw new Error(`${combo.label}: DB の金額が計画と一致しません（DB ${JSON.stringify(money)} / 計画 ${JSON.stringify(expected)}）`);
  }
  return `合計 ${money.total.toLocaleString('ja-JP')} 円（計画と一致）`;
}

loadEnv();
const xlsx = arg('xlsx') ?? DEFAULT_XLSX;
if (!fs.existsSync(xlsx)) {
  console.error(`確定資料が見つかりません: ${xlsx}`);
  process.exit(1);
}
const plan = buildRegistrationPlan(readXlsx(xlsx));
fs.mkdirSync(path.dirname(PLAN_OUT), { recursive: true });
fs.writeFileSync(PLAN_OUT, JSON.stringify(plan, null, 1));

console.log(`初期登録の計画（率：販売費率 ${Number(plan.rates.salesFeeRate) * 100}%・経費率 ${Number(plan.rates.expenseRate) * 100}%・掛率 ${Number(plan.rates.markupRate) * 100}%）`);
for (const combo of plan.combos) {
  console.log(
    `  ${combo.label.padEnd(30)} 本体 ${String(combo.base_lines.length).padStart(2)} 行・標準見積 ${String(combo.estimate_lines.length).padStart(2)} 行` +
      `（商品確定待ち ${String(combo.estimate_lines.filter((line) => line.price_mode === 'por').length).padStart(2)} 行）  ` +
      `税抜 ${combo.expected.subtotal.toLocaleString('ja-JP')} 円・税込 ${combo.expected.total.toLocaleString('ja-JP')} 円`
  );
}
console.log(`計画を ${PLAN_OUT} に書き出しました（原価を含むため commit しない）`);
if (plan.issues.length || plan.combos.length !== 10) {
  console.error(`計画に問題があります（組み合わせ ${plan.combos.length} 件・問題 ${plan.issues.length} 件）`);
  for (const issue of plan.issues) console.error(`  - ${issue}`);
  process.exit(1);
}

if (process.argv.includes('--apply')) {
  let ops: Ops;
  if (process.argv.includes('--supabase')) {
    if (!process.argv.includes('--yes-production')) {
      console.error('本番へ登録するには --yes-production を付けてください（本番 migration 適用後・承認後だけ）');
      process.exit(1);
    }
    ops = await supabaseOps();
  } else {
    const dbUrl = arg('db-url');
    const actor = arg('actor');
    if (!dbUrl || !actor) {
      console.error('--db-url と --actor（本部の利用者の profile id）を指定してください');
      process.exit(1);
    }
    ops = pgOps(dbUrl, actor);
  }
  let failed = false;
  try {
    for (const combo of plan.combos) {
      try {
        console.log(`  ${combo.label}: ${await registerCombo(ops, combo, plan)}`);
      } catch (e) {
        failed = true;
        console.error(`  ${combo.label}: 失敗 — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await ops.close();
  }
  if (failed) process.exit(1);
  console.log('初期登録が完了しました');
}
