import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928180000_non_web_quote_draft_lifecycle.sql'),
  'utf8'
);
const actions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const manualForm = fs.readFileSync(path.join(root, 'components/admin/manual-quote-form.tsx'), 'utf8');
const draftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const caseWorkspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');

describe('non-Web Quote Draft lifecycle migration', () => {
  it('allows non-Web cases without manufacturing a Configuration or customer profile', () => {
    expect(migration).toContain('alter column configuration_id drop not null');
    expect(migration).toContain('alter column user_id drop not null');
    expect(migration).toContain('add column if not exists created_by uuid');
    expect(migration).toContain('create or replace function public.create_manual_quote_case(');
    expect(migration).toContain("values(\n    null,\n    null,\n    null,\n    'reviewing'");
    expect(migration).not.toContain('insert into public.configurations');
    expect(migration).not.toContain('public.create_quote_from_configuration');
  });

  it('creates an empty formal-target Draft without issuing Revision 1', () => {
    const createStart = migration.indexOf('create or replace function public.create_manual_quote_case(');
    const readStart = migration.indexOf('create or replace function public.get_quote_draft(');
    const createBody = migration.slice(createStart, readStart);

    expect(createBody).toContain('insert into public.quote_requests');
    expect(createBody).toContain('insert into public.quote_drafts');
    expect(createBody).toContain("'formal'");
    expect(createBody).not.toContain('insert into public.quotes');
    expect(createBody).not.toContain('insert into public.quote_items');
  });

  it('keeps Draft writes behind SECURITY DEFINER RPCs and explicit EXECUTE grants', () => {
    for (const signature of [
      'public.create_manual_quote_case(jsonb, text, uuid, text, text)',
      'public.get_quote_draft(uuid)',
      'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)',
      'public.finalize_quote_draft(uuid, integer)',
    ]) {
      expect(migration).toContain('alter function ' + signature + ' owner to postgres;');
      expect(migration).toContain('revoke execute on function ' + signature);
      expect(migration).toContain('grant execute on function ' + signature + ' to authenticated;');
    }
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'");
  });

  it('matches the latest staff access boundary for non-Web Drafts and fails closed on NULL created_by', () => {
    expect(migration.match(/v_rank < 3 and d\.created_by is distinct from v_uid/g)?.length).toBe(3);
    expect(migration).not.toContain('if not (v_rank >= 3 or d.created_by = v_uid) then');
    expect(migration).not.toContain('v_rank >= 2 or d.created_by = v_uid');
    expect(migration).toContain('admin: all Drafts / master_dealer+dealer: only Drafts they created.');
  });

  it('uses optimistic locking and row locks for repeated Draft saves', () => {
    const saveStart = migration.indexOf('create or replace function public.save_quote_draft(');
    const finalizeStart = migration.indexOf('create or replace function public.finalize_quote_draft(');
    const saveBody = migration.slice(saveStart, finalizeStart);

    expect(saveBody).toContain('from public.quote_drafts');
    expect(saveBody).toContain('for update;');
    expect(saveBody).toContain('d.lock_version is distinct from p_expected_lock_version');
    expect(saveBody).not.toContain('d.lock_version <> p_expected_lock_version');
    expect(migration.match(/d\.lock_version is distinct from p_expected_lock_version/g)?.length).toBe(2);
    expect(saveBody).toContain('lock_version = lock_version + 1');
    expect(saveBody).toContain('delete from public.quote_draft_items');
  });

  it('rejects NULL expected_lock_version in both save and finalize RPCs', () => {
    expect(migration.match(/d\.lock_version is distinct from p_expected_lock_version/g)?.length).toBe(2);
    expect(migration).not.toContain('d.lock_version <> p_expected_lock_version');
  });

  it('validates quantity precision and recalculates Draft money in PostgreSQL', () => {
    expect(migration).toContain('v_qty <> round(v_qty, 4)');
    expect(migration).toContain("v_qty::text in ('NaN', 'Infinity', '-Infinity')");
    expect(migration).toContain('v_qty < 0.01 or v_qty > 99999');
    expect(migration).toContain("v_unit_price_raw::text in ('NaN', 'Infinity', '-Infinity')");
    expect(migration).toContain('v_unit_price_raw <> trunc(v_unit_price_raw)');
    expect(migration).toContain('v_amount_numeric := round(v_unit_price_raw * v_qty)');
    expect(migration).toContain('v_subtotal := v_subtotal_raw + v_adjustment');
    expect(migration).toContain('v_tax := floor(v_subtotal * d.tax_rate)');
    expect(migration).toContain('v_total := v_subtotal + v_tax');
  });

  it('uses adjustment for discounts instead of creating PDF-hidden negative detail rows', () => {
    expect(migration).toContain('値引きは調整額を使用してください');
    expect(draftEditor).toContain("filter((kind) => kind !== 'discount')");
  });

  it('preserves PR #275 Base Revision invariants and use permission', () => {
    expect(migration).toContain("rev.status in ('published', 'superseded')");
    expect(migration).toContain('master.base_model_id = d.base_model_id');
    expect(migration).toContain('public.can_use_base_master(v_base_master_id)');
    expect(migration).toContain('d.base_master_revision_id is null');
    expect(migration).toContain("o.status = 'published'");
    expect(migration).toContain('(o.base_model_id is null or o.base_model_id = d.base_model_id)');
  });

  it('keeps a Draft-pinned superseded Base Revision selectable after a newer publish', () => {
    expect(migration).toContain("rev.status in ('published', 'superseded')");
    expect(migration).toContain('rev.id = master.current_published_revision_id');
    expect(migration).toContain('or rev.id = d.base_master_revision_id');
  });

  it('finalizes only an initial formal Draft as immutable Revision 1 in one transaction', () => {
    const finalizeStart = migration.indexOf('create or replace function public.finalize_quote_draft(');
    const finalizeBody = migration.slice(finalizeStart);

    expect(finalizeBody).toContain('from public.quote_drafts');
    expect(finalizeBody).toContain('for update;');
    expect(finalizeBody).toContain('from public.quote_requests');
    expect(finalizeBody).toContain('d.parent_quote_id is not null');
    expect(finalizeBody).toContain("d.quote_kind <> 'formal'");
    expect(finalizeBody).toContain('r.quote_id is not null');
    expect(finalizeBody).toContain("raise exception 'VALIDATION: 区分別金額が保存可能範囲を超えています'");
    expect(finalizeBody).toContain('insert into public.quotes');
    expect(finalizeBody).toContain("    1,\n    null,\n    'formal',");
    expect(finalizeBody).toContain('insert into public.quote_items');
    expect(finalizeBody).toContain('update public.quote_requests');
    expect(finalizeBody).toContain('delete from public.quote_drafts');
  });

  it('recomputes item amounts again at finalization instead of trusting the Draft snapshot', () => {
    expect(migration).toContain('v_expected_amount := round(i.unit_price::numeric * i.quantity)');
    expect(migration).toContain('v_expected_amount <> i.amount');
    expect(migration).toContain('v_subtotal_raw <> d.subtotal_raw');
    expect(migration).toContain('v_subtotal <> d.subtotal or v_tax <> d.tax or v_total <> d.total');
    expect(migration).toContain('round(item.unit_price::numeric * item.quantity)::integer');
  });

  it('keeps existing Web creation/revision RPCs while hardening nullable customer acceptance', () => {
    expect(migration).not.toContain('create or replace function public.create_quote_from_configuration');
    expect(migration).not.toContain('create or replace function public.create_quote_revision');
    expect(migration).toContain('create or replace function public.respond_to_quote');
    expect(migration).toContain('if q.user_id is null or q.user_id is distinct from auth.uid() then');
    expect(migration).toContain('alter function public.respond_to_quote(uuid, text) owner to postgres;');
    expect(migration).toContain('grant execute on function public.respond_to_quote(uuid, text) to authenticated;');
  });

  it('blocks legacy Revision 2+ creation for Configuration-less non-Web series until PR #3', () => {
    expect(migration).toContain('create or replace function public.guard_non_web_revision_path()');
    expect(migration).toContain('parent.configuration_id is null');
    expect(migration).toContain('create trigger trg_quotes_non_web_revision_path');
    expect(migration).toContain('LOCKED: 非Web案件の改訂は次工程のRevision lifecycleから行ってください');
    expect(caseWorkspace).toContain('quote.configuration_id !== null');
  });
});

describe('non-Web manual case application wiring', () => {
  it('starts with quote_request + Draft instead of Configuration + preliminary Quote', () => {
    const start = actions.indexOf('export async function createManualQuoteAction');
    const end = actions.indexOf('export interface QuoteDraftFormState');
    const body = actions.slice(start, end);

    expect(body).toContain('store.createManualQuoteDraft');
    expect(body).toContain('redirect(`/admin/quotes/drafts/${draftId}?created=1`)');
    expect(body).not.toContain('saveConfiguration');
    expect(body).not.toContain('createQuoteFromConfiguration');
    expect(body).not.toContain('buildPresetSelection');
    expect(body).not.toContain('defaultVariantIdsFor');
  });

  it('exposes separate Draft save and formal finalize actions', () => {
    expect(actions).toContain('export async function saveQuoteDraftAction');
    expect(actions).toContain('quoteDraftSaveSchema.safeParse');
    expect(actions).toContain('store.saveQuoteDraft(');
    expect(actions).toContain('export async function finalizeQuoteDraftAction');
    expect(actions).toContain('quoteDraftFinalizeSchema.safeParse');
    expect(actions).toContain('store.finalizeQuoteDraft(');
  });

  it('connects Supabase only through the new lifecycle RPCs', () => {
    expect(supabaseStore).toContain("db.rpc('create_manual_quote_case'");
    expect(supabaseStore).toContain("db.rpc('get_quote_draft'");
    expect(supabaseStore).toContain("db.rpc('save_quote_draft'");
    expect(supabaseStore).toContain("db.rpc('finalize_quote_draft'");
  });

  it('keeps the case workspace usable when a non-Web Quote has no Configuration', () => {
    expect(supabaseStore).toContain("error.code === 'PGRST202' || error.code === '42883' || error.code === 'P0002'");
  });

  it('states clearly that case registration does not issue a quote', () => {
    expect(manualForm).toContain('登録時点では見積Revisionを発行しません。');
    expect(manualForm).toContain('正式保存');
    expect(manualForm).toContain('案件を登録して見積Draftを開く');
  });

  it('keeps Draft save and immutable Revision 1 finalization as separate UI actions', () => {
    expect(draftEditor).toContain('Draftを保存');
    expect(draftEditor).toContain('正式保存（Revision 1）');
    expect(draftEditor).toContain('未保存の変更があります。先にDraftを保存してください。');
    expect(draftEditor).toContain('DBが数量×単価・税額・合計を再計算します');
    expect(draftEditor).toContain('base_master_revision_id');
  });

  it('keeps edits made during a save marked dirty and blocks finalization while save is pending', () => {
    expect(draftEditor).toContain('const [editGeneration, setEditGeneration] = useState(0);');
    expect(draftEditor).toContain('const submittedGeneration = useRef<number | null>(null);');
    expect(draftEditor).toContain('submittedGeneration.current = editGeneration;');
    expect(draftEditor).toContain('if (editGeneration === submittedGeneration.current)');
    expect(draftEditor).toContain('setSavedGeneration(editGeneration);');
    expect(draftEditor).toContain('disabled={finalizePending || savePending || dirty || rows.length === 0 || !baseRevisionId}');
  });
});
