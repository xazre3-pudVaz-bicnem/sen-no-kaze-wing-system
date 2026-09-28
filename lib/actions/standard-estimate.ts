'use server';

import { revalidatePath } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

export type StandardEstimateCustomerSelection =
  | 'standard_changeable'
  | 'standard_fixed'
  | 'optional'
  | 'hidden'
  | 'none';

export interface StandardEstimateDraftLineInput {
  lineKey?: string | null;
  section: 'interior_exterior' | 'option' | 'sitework';
  groupLabel: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  remark: string;
  sourceKind: 'product' | 'free';
  optionId?: string | null;
  customerSelection: StandardEstimateCustomerSelection;
}

export interface StandardEstimateDraftSaveInput {
  revisionId?: string | null;
  expectedLockVersion?: number | null;
  baseModelId: string;
  baseMasterId: string;
  baseMasterRevisionId: string;
  specCode: string;
  name: string;
  taxRate: number;
  adjustment: number;
  adjustmentReason: string;
  lines: StandardEstimateDraftLineInput[];
}

export interface StandardEstimateDraftSaveResult {
  ok: boolean;
  error?: string;
  revisionId?: string;
  lockVersion?: number;
}

const SECTION_CODES = new Set(['interior_exterior', 'option', 'sitework']);
const CUSTOMER_SELECTIONS = new Set([
  'standard_changeable',
  'standard_fixed',
  'optional',
  'hidden',
  'none',
]);

function validateInput(input: StandardEstimateDraftSaveInput): string | null {
  if (!input.name.trim()) return '標準見積名を入力してください。';
  if (!input.baseModelId || !input.baseMasterId || !input.baseMasterRevisionId) {
    return '基準本体の情報が不足しています。';
  }
  if (!input.specCode || input.specCode !== input.specCode.trim().toLowerCase() || /\s/.test(input.specCode)) {
    return '用途・仕様の情報が不正です。';
  }
  if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 1) {
    return '税率が不正です。';
  }
  if (!Number.isInteger(input.adjustment)) return '調整額は1円単位で入力してください。';
  if (input.adjustment !== 0 && !input.adjustmentReason.trim()) {
    return '調整額がある場合は理由を入力してください。';
  }
  if (!Array.isArray(input.lines) || input.lines.length > 1000) {
    return '明細件数が不正です。';
  }

  for (let i = 0; i < input.lines.length; i += 1) {
    const line = input.lines[i];
    const lineNo = i + 1;
    if (!SECTION_CODES.has(line.section)) return `${lineNo}行目の区分が不正です。`;
    if (!line.name.trim()) return `${lineNo}行目の品名を入力してください。`;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return `${lineNo}行目の数量は0より大きい値にしてください。`;
    }
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
      return `${lineNo}行目の単価は0円以上の整数にしてください。`;
    }
    if (!CUSTOMER_SELECTIONS.has(line.customerSelection)) {
      return `${lineNo}行目のお客様選択区分が不正です。`;
    }
    if (line.sourceKind === 'product') {
      if (!line.optionId) return `${lineNo}行目の商品IDがありません。`;
      if (line.customerSelection === 'none') {
        return `${lineNo}行目の商品にはお客様選択区分が必要です。`;
      }
    } else if (line.sourceKind === 'free') {
      if (line.optionId) return `${lineNo}行目の自由明細に商品IDは設定できません。`;
      if (line.customerSelection !== 'none') {
        return `${lineNo}行目の自由明細のお客様選択区分が不正です。`;
      }
    } else {
      return `${lineNo}行目の明細種別が不正です。`;
    }
  }

  if (input.revisionId) {
    if (!Number.isInteger(input.expectedLockVersion) || (input.expectedLockVersion ?? -1) < 0) {
      return '下書きの更新情報が不正です。画面を再読込してください。';
    }
  }

  return null;
}

function normalizeError(message: string): string {
  const normalized = message.replace(/^(VALIDATION|CONFLICT|LOCKED|FORBIDDEN|NOT_FOUND):\s*/u, '');
  return normalized || '下書きの保存に失敗しました。';
}

export async function saveStandardEstimateDraftAction(
  input: StandardEstimateDraftSaveInput
): Promise<StandardEstimateDraftSaveResult> {
  await requireCatalogEditor('/admin/estimate-templates/new');

  if (isLocalMode()) {
    return { ok: false, error: 'DB接続環境でのみ下書きを保存できます。' };
  }

  const validationError = validateInput(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createClient();
  const lines = input.lines.map((line) => ({
    line_key: line.lineKey || null,
    section_code: line.section,
    group_label: line.groupLabel.trim() || null,
    name: line.name.trim(),
    quantity: line.quantity,
    unit: line.unit.trim() || null,
    unit_price: line.unitPrice,
    remark: line.remark.trim() || null,
    source_kind: line.sourceKind,
    option_id: line.optionId || null,
    customer_selection: line.customerSelection,
  }));

  const rpcName = input.revisionId
    ? 'save_standard_estimate_draft'
    : 'create_standard_estimate_draft';

  const args = input.revisionId
    ? {
        p_revision_id: input.revisionId,
        p_expected_lock_version: input.expectedLockVersion,
        p_name: input.name.trim(),
        p_tax_rate: input.taxRate,
        p_standard_adjustment_amount: input.adjustment,
        p_standard_adjustment_reason: input.adjustmentReason.trim() || null,
        p_lines: lines,
      }
    : {
        p_base_model_id: input.baseModelId,
        p_base_master_id: input.baseMasterId,
        p_base_master_revision_id: input.baseMasterRevisionId,
        p_spec_code: input.specCode,
        p_name: input.name.trim(),
        p_tax_rate: input.taxRate,
        p_standard_adjustment_amount: input.adjustment,
        p_standard_adjustment_reason: input.adjustmentReason.trim() || null,
        p_lines: lines,
      };

  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) {
    console.error('[wing] standard estimate draft save failed', {
      rpcName,
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: normalizeError(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id || !Number.isInteger(Number(row.lock_version))) {
    return { ok: false, error: '保存結果を確認できませんでした。画面を再読込してください。' };
  }

  revalidatePath('/admin/estimate-templates');
  revalidatePath('/admin/estimate-templates/new');

  return {
    ok: true,
    revisionId: String(row.id),
    lockVersion: Number(row.lock_version),
  };
}
