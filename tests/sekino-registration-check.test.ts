import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sekinoRegistrationWarnings } from '@/lib/domain/sekino-registration-check';

const option = { manufacturer: '株式会社セキノ興産', name: '角スパンドレル', model_no: 'SP-152K' };
const colorGroup = { id: 'color', name: 'カラー・色', status: 'published' as const };
const color = (name: string, status: 'draft' | 'published' = 'published') => ({
  group_id: 'color',
  name,
  status,
});

describe('セキノ興産 STEP2 の記載漏れ補助チェック', () => {
  it('セキノ興産を含まないメーカーでは何も表示しない', () => {
    expect(sekinoRegistrationWarnings({ ...option, manufacturer: '他メーカー' }, [colorGroup], [color('ブラック')])).toEqual([]);
  });

  it('メーカー名にセキノ興産を含めば対象となり、型番とカラー品番の記載漏れ候補を表示する', () => {
    const warnings = sekinoRegistrationWarnings(
      { ...option, model_no: null },
      [colorGroup],
      [color('ピッチブラック'), color('U96Z ピッチブラック')]
    );
    expect(warnings).toContain('シリーズ・型番／品番が未入力です。');
    expect(warnings).toContain('「カラー・色」の「ピッチブラック」：色番号の記載がない可能性があります。');
    expect(warnings).not.toContain('「カラー・色」の「U96Z ピッチブラック」：色番号の記載がない可能性があります。');
  });

  it('アルファベットと数字、数字のみ、全角の番号らしい表記を検出できる', () => {
    expect(sekinoRegistrationWarnings(option, [colorGroup], [
      color('U96Z ピッチブラック'),
      color('SP-51 ブラック'),
      color('708 グレー'),
      color('Ｕ９６Ｚ ピッチブラック'),
    ])).toEqual([]);
  });

  it('カラー選択肢がない商品や非公開のグループ・選択肢を警告対象にしない', () => {
    expect(sekinoRegistrationWarnings(option, [], [])).toEqual([]);
    expect(sekinoRegistrationWarnings(option, [{ ...colorGroup, status: 'draft' }], [color('ブラック')])).toEqual([]);
    expect(sekinoRegistrationWarnings(option, [colorGroup], [color('ブラック', 'draft')])).toEqual([]);
    expect(sekinoRegistrationWarnings(option, [
      { id: 'size', name: 'サイズ', status: 'published' },
    ], [{ group_id: 'size', name: 'ブラック', status: 'published' }])).toEqual([]);
  });

  it('STEP2だけに注意欄を出し、公開処理や登録入力欄を変更しない', () => {
    const page = readFileSync('app/admin/options/[id]/page.tsx', 'utf8');
    expect(page).toContain('const sekinoWarnings = sekinoRegistrationWarnings(option, variants.groups, variants.choices);');
    expect(page).toContain('data-testid="sekino-step2-color-code-check"');
    expect(page).toContain('品番の正確さは担当者が最終確認してください。');
    expect(page).toContain("step === 'preview' && (");
  });
});
