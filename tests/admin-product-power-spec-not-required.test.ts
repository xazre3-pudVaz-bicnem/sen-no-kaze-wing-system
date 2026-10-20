import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 2026-10-16 の先方判断：空調商品の電源仕様は専用の必須項目として使わない（#510 の corrective）。
// 電源仕様は既存の商品仕様欄（空調の「能力クラス・電源」など）に書く。DB の options.power_spec（null 可）は残す。

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const editPage = read('app/admin/options/[id]/page.tsx');
const forms = read('components/admin/forms.tsx');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('空調商品の電源仕様を専用の必須項目にしない', () => {
  it('商品登録の STEP2 への移動と公開は、電源仕様が未入力でも妨げない', () => {
    expect(editPage).not.toContain('電源仕様を入力してください');
    expect(editPage).not.toMatch(/PowerSpec|powerSpec|power_spec/);
    // 公開は従来の処理（電源仕様の確認を挟まない）
    expect(editPage).toContain("import { deleteOptionAction, publishOptionAction } from '@/lib/actions/admin';");
    expect(editPage).toContain('<form action={publishOptionAction} className="space-y-3">');
  });

  it('専用の入力欄・保存処理・判定は置かず、価格単位の部品は商品編集ページに直接置く', () => {
    for (const file of [
      'components/admin/product-power-spec.tsx',
      'lib/actions/product-power-spec.ts',
      'lib/domain/product-power-spec.ts',
      'types/product-power-spec.d.ts',
    ]) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(false);
    }
    expect(editPage).toContain('<ProductPriceUnitRegistrationField optionId={id} />');
    expect(editPage).toContain('<ProductPriceUnitPublishedCard optionId={id} />');
    expect(editPage).toContain('<ProductPriceUnitRouteSummary />');
  });

  it('アプリは power_spec 列を読み書きしない', () => {
    const offenders = ['app', 'components', 'lib', 'types']
      .flatMap(sourceFiles)
      .filter((file) => read(file).includes('power_spec'));
    expect(offenders).toEqual([]);
  });

  it('電源仕様は既存の商品仕様欄に書ける（空調の「能力クラス・電源」）', () => {
    expect(forms).toContain("aircon: { label: '能力クラス・電源', placeholder: '例：2.2kW（6畳程度）／単相100V' },");
    expect(forms).toContain("fixedInfo: ['能力クラス', '電源', '室内機・室外機', '寒冷地対応（必要な場合）'],");
  });

  it('適用前の migration は編集せず、列を消すための migration も足さない（null 可の列として残す）', () => {
    expect(read('supabase/migrations/20261015180000_option_power_spec.sql')).toContain(
      'alter table public.options\n  add column if not exists power_spec text;'
    );
    const dropping = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .filter((file) => /drop\s+column\s+(if\s+exists\s+)?power_spec/i.test(read(path.join('supabase/migrations', file))));
    expect(dropping).toEqual([]);
  });
});
