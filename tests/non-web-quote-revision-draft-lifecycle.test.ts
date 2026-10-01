import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928210000_non_web_quote_revision_draft_lifecycle.sql'),
  'utf8'
);
const actions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const authoringUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');
const draftPage = fs.readFileSync(path.join(root, 'app/admin/quotes/drafts/[id]/page.tsx'), 'utf8');

describe('non-Web Quote Revision 2+ Draft lifecycle', () => {
  it('scopes revision-number uniqueness to non-Web series', () => {
    expect(migration).toContain('create unique index if not exists quotes_non_web_request_revision_uidx');
    expect(migration).toContain('on public.quotes(quote_request_id, revision)');
    expect(migration).toContain('where configuration_id is null');
  });

  it('creates a Draft only from the current issued formal non-Web Revision under row locks', () => {
    const body = migration.slice(
      migration.indexOf('create or replace function public.create_quote_revision_draft'),
      migration.indexOf('create or replace function public.save_quote_draft')
    );
    expect(body).toContain('from public.quotes');
    expect(body).toContain('for update;');
    expect(body).toContain("parent.quote_kind is distinct from 'formal'");
    expect(body).toContain("parent.status <> 'issued'");
    expect(body).toContain('r.quote_id is distinct from parent.id');
    expect(body).toContain('v_rank < 3 and parent.dealer_id is distinct from v_uid');
    expect(body).toContain('parent.configuration_id is not null');
  });

  it('copies line identity and exact stored amount without recalculating the parent snapshot', () => {
    const body = migration.slice(
      migration.indexOf('create or replace function public.create_quote_revision_draft'),
      migration.indexOf('create or replace function public.save_quote_draft')
    );
    expect(body).toContain('item.line_key');
    expect(body).toContain('item.amount');
    expect(body).toContain('parent.subtotal - parent.adjustment');
    expect(body).not.toContain('round(item.unit_price');
  });

  it('keeps stable Draft identity and preserves parent amount for unchanged quantity and price', () => {
    const body = migration.slice(
      migration.indexOf('create or replace function public.save_quote_draft'),
      migration.indexOf('create or replace function public.guard_non_web_revision_path')
    );
    expect(body).toContain('on conflict (draft_id, line_key) do update');
    expect(body).toContain('v_parent_item.unit_price = v_unit_price');
    expect(body).toContain('v_parent_item.quantity = v_qty');
    expect(body).toContain('v_amount := v_parent_item.amount');
    expect(body).toContain('v_amount_numeric := round(v_unit_price_raw * v_qty)');
    expect(body).toContain('他の見積系列のline_keyは使用できません');
  });

  it('keeps parent-pinned history usable while validating changed references', () => {
    expect(migration).toContain('v_parent_item.option_id is not distinct from v_option_id');
    expect(migration).toContain("rev.status in ('published', 'superseded')");
    expect(migration).toContain('rev.id = d.base_master_revision_id');
    expect(migration).toContain("master.status = 'active'");
    expect(migration).toContain('p_base_master_revision_id is not distinct from parent.base_master_revision_id');
    expect(migration).toContain('public.can_use_base_master(v_base_master_id)');
  });

  it('uses current Quote assignment as the Revision Draft authorization source', () => {
    const readBody = migration.slice(
      migration.indexOf('create or replace function public.get_quote_draft'),
      migration.indexOf('create or replace function public.create_quote_revision_draft')
    );
    const createBody = migration.slice(
      migration.indexOf('create or replace function public.create_quote_revision_draft'),
      migration.indexOf('create or replace function public.save_quote_draft')
    );
    const saveBody = migration.slice(
      migration.indexOf('create or replace function public.save_quote_draft'),
      migration.indexOf('create or replace function public.guard_non_web_revision_path')
    );
    const finalizeBody = migration.slice(
      migration.indexOf('create or replace function public.finalize_quote_revision_draft')
    );

    expect(readBody).toContain('if d.parent_quote_id is null then');
    expect(readBody).toContain('d.created_by is distinct from v_uid');
    expect(readBody).toContain('parent.dealer_id is distinct from v_uid');
    expect(createBody).not.toContain('v_existing.created_by is distinct from v_uid');
    expect(createBody.indexOf('parent.dealer_id is distinct from v_uid')).toBeLessThan(
      createBody.indexOf('parent.configuration_id is not null')
    );
    expect(saveBody).toContain('if d.parent_quote_id is null');
    expect(saveBody).toContain('parent.dealer_id is distinct from v_uid');
    expect(saveBody.indexOf('parent.dealer_id is distinct from v_uid')).toBeLessThan(
      saveBody.indexOf('d.lock_version is distinct from p_expected_lock_version')
    );
    expect(finalizeBody).toContain('parent.dealer_id is distinct from v_uid');
    expect(finalizeBody.indexOf('parent.dealer_id is distinct from v_uid')).toBeLessThan(
      finalizeBody.indexOf('d.lock_version is distinct from p_expected_lock_version')
    );
    expect(finalizeBody).not.toContain('d.created_by is distinct from v_uid');
  });

  it('prevents dealer from changing Base Revision or base/base_expense snapshot in Revision Drafts', () => {
    const saveBody = migration.slice(
      migration.indexOf('create or replace function public.save_quote_draft'),
      migration.indexOf('create or replace function public.guard_non_web_revision_path')
    );
    const finalizeBody = migration.slice(
      migration.indexOf('create or replace function public.finalize_quote_revision_draft')
    );

    for (const body of [saveBody, finalizeBody]) {
      expect(body).toContain('v_can_edit_base := v_rank >= 2');
      expect(body).toContain('本体Revisionを変更できるのは総代理店・本部だけです');
      expect(body).toContain('本体明細を変更できるのは総代理店・本部だけです');
      expect(body).toContain('本体明細を追加できるのは総代理店・本部だけです');
      expect(body).toContain('本体明細を削除できるのは総代理店・本部だけです');
      expect(body).toContain("item.kind in ('base', 'base_expense')");
    }
    expect(saveBody).toContain('v_lock_parent_base');
    expect(saveBody).toContain('case when v_lock_parent_base then v_parent_item.name else v_name end');
    expect(finalizeBody).toContain('v_parent_item.name is distinct from i.name');
    expect(finalizeBody).toContain('v_parent_item.image_url is distinct from i.image_url');

    expect(draftPage).toContain('canEditBase={canEditCatalog(actor.role)}');
    expect(editor).toContain('const baseLocked = isRevisionDraft && !canEditBase;');
    expect(editor).toContain('disabled={baseLocked}');
    expect(editor).toContain('const rowBaseLocked = baseLocked');
    expect(editor).toContain("kind !== 'base' && kind !== 'base_expense'");
    expect(editor).toContain('locked: rowBaseLocked');
    expect(authoringUi).toContain('const rowLocked = Boolean(row.locked || !sectionEditable);');
    expect(authoringUi).toContain('disabled={rowLocked}');
  });

  it('revalidates new or changed options again at formalization time', () => {
    const finalizeBody = migration.slice(
      migration.indexOf('create or replace function public.finalize_quote_revision_draft')
    );
    expect(finalizeBody).toContain('v_parent_item.option_id is not distinct from i.option_id');
    expect(finalizeBody).toContain('from public.options o');
    expect(finalizeBody).toContain("o.status = 'published'");
    expect(finalizeBody).toContain('o.base_model_id is null or o.base_model_id = d.base_model_id');
    expect(finalizeBody).toContain('正式保存時点で利用できる公開商品を指定してください');
  });

  it('finalizes N+1 atomically against the current parent and moves the current pointer', () => {
    const body = migration.slice(
      migration.indexOf('create or replace function public.finalize_quote_revision_draft')
    );
    expect(body).toContain('from public.quote_drafts');
    expect(body).toContain('from public.quotes');
    expect(body).toContain('from public.quote_requests');
    expect(body).toContain('for update;');
    expect(body).toContain('r.quote_id is distinct from parent.id');
    expect(body).toContain('v_next_revision := parent.revision + 1');
    expect(body).toContain('d.adjustment_reason');
    expect(body).toContain('item.amount');
    expect(body).toContain("set status = 'superseded'");
    expect(body).toContain('set quote_id = v_quote_id');
    expect(body).toContain("status = 'reviewing'");
    expect(body).toContain('delete from public.quote_drafts');
  });

  it('keeps legacy direct non-Web child creation blocked by the snapshot contract', () => {
    expect(migration).toContain('create or replace function public.guard_non_web_revision_path()');
    expect(migration).toContain("new.quote_kind is distinct from 'formal'");
    expect(migration).toContain('new.base_master_revision_id is null');
    expect(migration).toContain('非Web案件の改訂はRevision Draft lifecycleから行ってください');
    expect(migration).not.toContain('create or replace function public.create_quote_revision(');
  });

  it('hardens SECURITY DEFINER ownership and EXECUTE ACL', () => {
    for (const signature of [
      'public.get_quote_draft(uuid)',
      'public.create_quote_revision_draft(uuid)',
      'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)',
      'public.finalize_quote_revision_draft(uuid, integer)',
    ]) {
      expect(migration).toContain('alter function ' + signature + ' owner to postgres;');
      expect(migration).toContain('revoke execute on function ' + signature);
      expect(migration).toContain('grant execute on function ' + signature + ' to authenticated;');
    }
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('QUOTE_REVISION_DRAFT_OWNER_INVALID');
  });

  it('wires only non-Web revisions to the new Draft flow while retaining Web legacy revision wiring', () => {
    expect(store).toContain('createQuoteRevisionDraft');
    expect(supabaseStore).toContain("db.rpc('create_quote_revision_draft'");
    expect(actions).toContain('export async function createQuoteRevisionDraftAction');
    expect(workspace).toContain('const canCreateRevisionDraft =');
    expect(workspace).toContain('quote.configuration_id === null');
    expect(workspace).toContain('const canUseLegacyRevision =');
    expect(workspace).toContain('quote.configuration_id !== null');
    expect(editor).toContain('const isRevisionDraft = detail.draft.parent_quote_id !== null;');
    expect(editor).toContain('targetRevision = 1');
    expect(editor).toContain('const formalRevisionLabel = `第${targetRevision}版`;');
  });
});
