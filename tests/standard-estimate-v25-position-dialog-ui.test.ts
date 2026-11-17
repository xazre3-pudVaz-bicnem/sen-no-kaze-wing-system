import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V25_POSITION_LABEL_SUGGESTIONS, v25PositionLabelSuggestions } from '@/lib/domain/standard-estimate-v25-position-label-suggestions';

const src = readFileSync(resolve(process.cwd(), 'components/admin/standard-estimate-v25-workbench.tsx'), 'utf8');
const positionDialog = src.slice(src.indexOf('{positionSlot && positionDraft && ('), src.indexOf('{replacementDraft && replacementSource && ('));
const alternativePicker = src.slice(src.indexOf('{selectableSlot && selectableBase && ('), src.indexOf('</section>', src.indexOf('{selectableSlot && selectableBase && (')));

describe('標準見積v2.5 位置名候補はサッシと照明だけ', () => {
  it('サッシ候補は指定の7件を正しい順序で返す', () => {
    expect(v25PositionLabelSuggestions('sash')).toEqual([
      '居室の窓', 'LDKの窓', '寝室の窓', '浴室の窓', 'トイレの窓', 'キッチンの窓', '玄関横の窓',
    ]);
    expect(V25_POSITION_LABEL_SUGGESTIONS.sash).toHaveLength(7);
  });
  it('照明候補は指定の9件を正しい順序で返す', () => {
    expect(v25PositionLabelSuggestions('lighting')).toEqual([
      '居室', 'LDK', '寝室', '玄関', 'キッチン', 'トイレ', '洗面脱衣室', '浴室', '屋外',
    ]);
    expect(V25_POSITION_LABEL_SUGGESTIONS.lighting).toHaveLength(9);
  });
  it('カテゴリー名の推測をせず、その他のカテゴリーには候補を出さない', () => {
    for (const code of ['equipment', 'roof', 'ub', 'toilet', 'aircon', 'SASH', '', 'light']) {
      expect(v25PositionLabelSuggestions(code)).toEqual([]);
    }
    expect(v25PositionLabelSuggestions(null)).toEqual([]);
    expect(v25PositionLabelSuggestions(undefined)).toEqual([]);
    expect(src).toContain('v25PositionLabelSuggestions(positionCandidate?.categoryCode)');
    expect(positionDialog).toContain('{positionLabelSuggestions.length > 0 && (');
  });
});

describe('標準見積v2.5 位置設定ダイアログ：保存形式を変えないUI', () => {
  it('位置を設定に統一し、既存標準商品は上部に一度だけ表示する', () => {
    expect(src).not.toContain('位置別設定');
    expect(positionDialog).toContain('aria-label="位置を設定"');
    expect(positionDialog).toContain('data-testid="v25-wb-position-standard-product"');
    expect(positionDialog).toContain('標準商品：{positionCandidate?.name');
    expect(positionDialog).not.toContain('この行の標準品');
    expect(positionDialog).toContain('① この商品をどこに使いますか？');
    expect(positionDialog).toContain('② お客様が選べる別の商品（任意）');
    expect(positionDialog).toContain('＋ 別の商品を選ぶ');
    expect(positionDialog).toContain('変更候補なし（標準商品のみ）');
    expect(positionDialog).toContain("'設定を反映'");
    expect(positionDialog).toContain('最後に「下書きを保存」してください');
    expect(src).toContain('data-testid="v25-wb-slot-position-menu"');
    expect(src).toContain('data-testid="v25-wb-slot-position-toggle"');
  });

  it('未選択が既定、選択後も同じ位置名Inputで自由修正でき、既存値を勝手に変えない', () => {
    expect(positionDialog).toContain('value={positionLabelSuggestions.includes(positionDraft.slot_label) ? positionDraft.slot_label : \'\'}');
    expect(positionDialog).toContain('<option value="">候補から選ぶ（任意）</option>');
    expect(positionDialog).toContain('onChange={(event) => {');
    expect(positionDialog).toContain('if (event.target.value) updatePosition({ slot_label: event.target.value })');
    expect(positionDialog).toContain('value={positionDraft.slot_label}');
    expect(positionDialog).toContain('maxLength={40}');
    expect(positionDialog).toContain('onChange={(event) => updatePosition({ slot_label: event.target.value })}');
    expect(src).toContain('setPositionDraft({ slot_code: slot.slot_code, slot_label: slot.slot_label, selectable_option_ids: [...slot.selectable_option_ids] })');
    expect(src).toContain('setPositionDraft(null)');
    expect(src).toContain('updateV25Position(state, positionFor, positionDraft.slot_label');
    // 候補名を永続化形式・位置識別子には加えず、検証は既存ドメインのまま
    expect(src).toContain('clearV25Position(state, positionFor)');
    expect(src).toContain('updateV25Position(state, positionFor, positionDraft.slot_label');
    expect(src).not.toContain('candidatePositionLabel');
  });

  it('標準品の変更候補と窓タイプ絞込、複数選択・二段階キャンセルを維持する', () => {
    expect(src).toContain('candidate.id !== selectableBase.id && !candidate.retired && !candidate.unavailable && candidate.categoryId === selectableBase.categoryId');
    expect(src).toContain('const selectableDraftIds');
    expect(src).toContain('setSelectableDraftIds([...(positionDraft?.selectable_option_ids ?? [])])');
    expect(src).toContain('setSelectableDraftIds((current) => current');
    expect(src).toContain('if (selectableDraftIds) updatePosition({ selectable_option_ids: [...selectableDraftIds] })');
    expect(src).toContain('const closeSelectable = () =>');
    expect(src).toContain('setSelectableDraftIds(null)');
    expect(alternativePicker).toContain('selectableBase.usesWindowType');
    expect(alternativePicker).toContain('data-testid="v25-wb-selectable-window-type"');
    expect(alternativePicker).toContain('toggleSelectableDraft(candidate.id)');
    expect(src).toContain("!selectableWindowType || (selectableWindowType === NO_WINDOW_TYPE");
    // 窓タイプは任意の絞込であって、異なる窓タイプの商品を恒久的に除外しない
    expect(src).toContain("setSelectableWindowType('')");
    expect(src).toContain("const selectableOptions = useMemo(");
  });

  it('内部の位置識別子は画面から隠し、解除と確認・保存処理は以前のまま', () => {
    expect(positionDialog).not.toContain('識別子：');
    expect(alternativePicker).not.toContain('positionDraft?.slot_code.trim()');
    expect(positionDialog).toContain('{positionSlot.slot_code.trim() && !readOnly && (');
    expect(positionDialog).toContain('位置設定を解除');
    expect(positionDialog).toContain('setRemovePositionOnConfirm(true)');
    expect(positionDialog).toContain('位置名と変更候補を外します');
    expect(positionDialog).toContain("{removePositionOnConfirm ? '位置設定を解除する' : '設定を反映'}");
    expect(src).toContain('const result = removePositionOnConfirm');
    expect(src).toContain('clearV25Position(state, positionFor)');
    expect(src).toContain('if (result.error) { setPositionError(result.error); return; }');
    expect(src).toContain('setState(result.state)');
    expect(positionDialog).toContain('現在の数量は {positionSlot.quantity} です。新しく位置を設定するには数量１が必要です。自動変更はしません。');
    expect(src).toContain('dirty={!readOnly && (removePositionOnConfirm || positionDraft.slot_label !== positionSlot.slot_label');
  });
});
