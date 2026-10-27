import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261014101000_unused_published_product_safe_delete.sql'),
  'utf8'
);
const hardeningMigration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261014102000_unused_published_product_safe_delete_hardening.sql'),
  'utf8'
);
const action = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/unused-published-product-delete.ts'),
  'utf8'
);
const control = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/published-option-delete-control.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'), 'utf8');
const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');
const dbCheck = fs.readFileSync(path.resolve(process.cwd(), 'scripts/db-rehearsal/check.mjs'), 'utf8');
const runtimeSql = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/db-rehearsal/runtime-unused-published-option-delete.sql'),
  'utf8'
);
const runtimeMjs = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/db-rehearsal/runtime-unused-published-option-delete.mjs'),
  'utf8'
);
const arrayRaceMjs = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/db-rehearsal/runtime-unused-published-option-array-race.mjs'),
  'utf8'
);
const writerOrderMjs = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/db-rehearsal/runtime-unused-published-option-writer-order.mjs'),
  'utf8'
);

describe('登録済み未使用商品の安全削除', () => {
  it('DB RPCが認証・商品編集権限・published限定・短いlock timeoutを強制する', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('auth.uid() is null');
    expect(migration).toContain('public.can_edit_catalog()');
    expect(migration).toContain("v_option_status <> 'published'");
    expect(migration).toContain('for update');
    expect(migration).toContain("set lock_timeout = '2s'");
    expect(hardeningMigration).toContain('security definer');
    expect(hardeningMigration).toContain("set lock_timeout = '2s'");
  });

  it('保存済み仕様・見積・標準見積・履歴・商品ルール・Presetを参照確認する', () => {
    for (const table of [
      'public.configuration_items',
      'public.configurations',
      'public.configuration_snapshots',
      'public.quote_draft_items',
      'public.quote_items',
      'public.standard_estimate_revision_baseline_items',
      'public.estimate_templates',
      'public.legacy_migration_financial_snapshots',
      'public.quote_internal_snapshots',
      'public.option_dependencies',
      'public.option_conflicts',
      'public.base_models',
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain('variant_choice_ids');
    expect(migration).toContain("preset.value -> 'option_codes'");
  });

  it('JSON/配列参照とvariant所属変更の確認中は対象テーブルの書込み競合を防ぐ', () => {
    expect(migration).toContain('lock table');
    expect(migration).toContain('in share mode;');
    for (const table of [
      'public.configuration_items',
      'public.configuration_snapshots',
      'public.estimate_templates',
      'public.legacy_migration_financial_snapshots',
      'public.quote_internal_snapshots',
      'public.option_variant_groups',
      'public.option_variant_choices',
    ]) {
      expect(migration).toContain(table);
    }
  });

  it('非FK参照は保存時にも存在検証し、DELETE後のstale writeをfail-closedにする', () => {
    for (const marker of [
      'validate_base_model_preset_option_refs',
      'base_models_preset_option_refs_validate',
      'validate_estimate_template_baseline_option_refs',
      'estimate_templates_baseline_option_refs_validate',
      'validate_configuration_item_variant_refs',
      'configuration_items_variant_refs_validate',
      'validate_configuration_snapshot_option_refs',
      'configuration_snapshots_option_refs_validate',
      'validate_quote_internal_snapshot_option_refs',
      'quote_internal_snapshots_option_refs_validate',
      'validate_legacy_migration_snapshot_option_refs',
      'legacy_migration_snapshot_option_refs_validate',
      '安全確認ができないため削除を停止しました',
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it('Presetの技術キーoptions.codeをimmutableにし、legacy dangling codeもfail-closedにする', () => {
    expect(hardeningMigration).toContain('create or replace function public.prevent_option_code_update()');
    expect(hardeningMigration).toContain('before update of code on public.options');
    expect(hardeningMigration).toContain('new.code is distinct from old.code');
    expect(hardeningMigration).toContain('本体Presetに存在しない商品codeが含まれています');
    expect(hardeningMigration).toContain('left join public.options o on o.code = preset_option.code');
  });

  it('参照確認は削除トリガーで行い、どの削除経路（RPC・下書きのDELETE・連鎖削除）でも同じ確認を通す', () => {
    expect(hardeningMigration).toContain('create or replace function public.assert_option_unreferenced(p_option_id uuid, p_option_code text)');
    expect(hardeningMigration).toContain('before delete on public.options');
    expect(hardeningMigration).toContain('perform public.assert_option_unreferenced(old.id, old.code);');
    for (const table of [
      'public.configuration_items',
      'public.configurations',
      'public.configuration_snapshots',
      'public.quote_draft_items',
      'public.quote_items',
      'public.standard_estimate_revision_baseline_items',
      'public.estimate_templates',
      'public.legacy_migration_financial_snapshots',
      'public.quote_internal_snapshots',
      'public.option_dependencies',
      'public.option_conflicts',
      'public.base_models',
    ]) {
      expect(hardeningMigration).toContain(table);
    }
    expect(hardeningMigration).toContain("face.value ->> 'option_id' = p_option_id::text");
    expect(hardeningMigration).toContain('where preset_option.code = p_option_code');
    // 安全削除 RPC 自体は参照確認を持たず、削除トリガーに任せる（経路ごとの差を作らない）
    expect(hardeningMigration).toContain("delete from public.options o where o.id = p_option_id and o.status = 'published';");
  });

  it('確認中の表は待たずにlockし（NOWAIT）、取れなければ間をおいてやり直し、最後は使用中として中断する', () => {
    const lockStart = hardeningMigration.indexOf('lock table\n        public.configurations,');
    const nowait = hardeningMigration.indexOf('in share mode nowait;');
    expect(lockStart).toBeGreaterThan(-1);
    expect(nowait).toBeGreaterThan(lockStart);
    const order = [
      'public.configurations,',
      'public.configuration_items,',
      'public.configuration_snapshots,',
      'public.quote_internal_snapshots,',
      'public.estimate_templates,',
      'public.legacy_migration_financial_snapshots,',
      'public.base_models,',
      'public.option_variant_groups,',
      'public.option_variant_choices',
    ].map((table) => hardeningMigration.indexOf(table, lockStart));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(hardeningMigration).toContain('exception when lock_not_available then');
    expect(hardeningMigration).toContain('perform pg_catalog.pg_sleep(0.1);');
    expect(hardeningMigration).toContain('if v_attempt >= 15 then');
    expect(hardeningMigration).toContain('LOCKED: 現在ほかの処理で使用中のため削除できません。少し時間をおいて再度お試しください。');
    // 商品行の待ちは lock_timeout まで。待ち切れ・deadlock は raw で返さず使用中にする
    expect(hardeningMigration).toContain("set lock_timeout = '2s'");
    expect(hardeningMigration).toContain('when lock_not_available or deadlock_detected then');
  });

  it('publishedの通常DELETEを閉じ、service_roleのRLS迂回とapplication TRUNCATEも遮断する', () => {
    expect(migration).toContain('as restrictive');
    expect(migration).toContain("using (status = 'draft');");
    expect(hardeningMigration).toContain('revoke all on function public.assert_option_unreferenced(uuid, text) from public, anon, authenticated, service_role;');
    expect(hardeningMigration).toContain('revoke all on function public.guard_option_delete() from public, anon, authenticated, service_role;');
    expect(hardeningMigration).toContain('grant execute on function public.delete_unused_published_option(uuid) to authenticated;');
    expect(migration).toContain('revoke delete on table public.options from service_role;');
    expect(migration).toContain('revoke truncate on table public.options from anon, authenticated, service_role;');
  });

  it('Server Actionも商品編集権限を要求し、本番・demo fallbackではfail-closedする', () => {
    expect(action).toContain('await requireCatalogEditor();');
    expect(action).toContain("option.status !== 'published'");
    expect(action).toContain("db.rpc('delete_unused_published_option'");
    expect(action).toContain("error.code === 'PGRST202'");
    expect(action).toContain('isDemoFallback()');
    expect(action).toContain('else if (isLocalMode())');
  });

  it('登録済み商品の削除UIは商品編集権限がある場合だけ有効化される', () => {
    expect(control).toContain('登録済み商品の削除（未使用のみ）');
    expect(control).toContain('この商品を削除');
    expect(editPage).toContain('{catalogEditor && <PublishedOptionDeleteControl optionId={id} />}');
    expect(control).not.toContain('createPortal');
    expect(layout).not.toContain('<PublishedOptionDeleteControl');
  });

  it('DB Rehearsalで主要な使用済み経路・ACL・fail-closedを実動作確認する', () => {
    expect(dbCheck).toContain('runtimeUnusedPublishedOptionDelete(client, { connectionString: url })');
    for (const marker of [
      'anonはRPCを実行できない',
      'dealerはRPCで削除できない',
      'adminは未使用publishedを削除できる',
      '商品ルールで使用中なら削除を拒否する',
      'Configuration直参照なら削除を拒否する',
      'variant_choice_ids参照なら削除を拒否する',
      'Configuration Snapshot参照なら削除を拒否する',
      'Quote参照なら削除を拒否する',
      'Standard Estimate Revision参照なら削除を拒否する',
      'Preset code参照なら削除を拒否する',
      'service_roleのpublished直接DELETEはtable ACLで拒否する',
      '既存のdraft直接DELETEは維持する',
      'draftへ戻したPreset使用中の商品も直接DELETEで削除できない',
      'draftへ戻した外壁4面使用中の商品も直接DELETEで削除できない',
      'どちらの商品も残り、Presetに消えたcodeは残らない',
      'JSON形式異常があれば安全確認不能として削除を停止する',
    ]) {
      expect(runtimeSql).toContain(marker);
    }
    expect(runtimeSql).toContain('rollback;');
  });

  it('DB Rehearsalでvariant所属変更race・商品行のlock timeout・表の使用中を2接続以上で実動作確認する', () => {
    expect(runtimeMjs).toContain('variant所属変更race');
    expect(runtimeMjs).toContain("wait_event = 'PgSleep'");
    expect(runtimeMjs).toContain("'RowExclusiveLock'");
    expect(runtimeMjs).toContain("moveResult.code === '23503'");
    expect(runtimeMjs).toContain('isBusyAbort(timeoutResult)');
    expect(runtimeMjs).toContain('表が使用中のままなら待ち続けず、使用中として商品を残す');
    expect(runtimeMjs).toContain("new pg.Client({ connectionString })");
  });

  it('DB Rehearsalでvariant_choice_idsへのstale write raceも実動作確認する', () => {
    expect(dbCheck).toContain('runtimeUnusedPublishedOptionArrayRace({ connectionString: url })');
    expect(arrayRaceMjs).toContain('variant_choice_ids書込みは表の解放を待つ');
    expect(arrayRaceMjs).toContain("wait_event = 'PgSleep'");
    expect(arrayRaceMjs).toContain("'RowExclusiveLock'");
    expect(arrayRaceMjs).toContain("writeResult.code === 'P0001'");
    expect(arrayRaceMjs).toContain('削除後にdangling Choice UUIDは残らない');
  });

  it('DB Rehearsalでoptions.codeと既存writerのdeadlock回避を実RPCで確認する', () => {
    expect(dbCheck).toContain('runtimeUnusedPublishedOptionWriterOrder({ connectionString: url })');
    expect(writerOrderMjs).toContain('options.codeの既存行変更をDBで拒否する');
    expect(writerOrderMjs).toContain('save_configuration_atomic');
    expect(writerOrderMjs).toContain('apply_catalog_import');
    expect(writerOrderMjs).toContain("unrelated.save.code !== '40P01'");
    expect(writerOrderMjs).toContain("importResult.code !== '40P01'");
    expect(writerOrderMjs).toContain('safe-deleteは保存中の表を待たず、lockを持たずにやり直す');
    expect(writerOrderMjs).toContain('safe-deleteはOption行待ち中にvariant SHAREを保持しない');
    // 削除対象そのものを含む保存の最中：保存は成功し、削除側は使用中で中断する
    expect(writerOrderMjs).toContain('保存は成功し、safe-deleteは使用中として中断する（40P01を返さない）');
    expect(writerOrderMjs).toContain('商品は誤削除されず、保存したプランから参照されたまま残る');
  });
});
