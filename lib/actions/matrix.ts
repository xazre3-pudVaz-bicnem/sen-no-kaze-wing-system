'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, StoreError } from '@/lib/data/store';
import type { MatrixRow } from '@/lib/domain/types';

export type MatrixActionResult = { ok: true; row: MatrixRow; message: string } | { ok: false; error: string };

const itemCodes = z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(100);

const updateSchema = z.object({
  row_id: z.uuid(),
  fire_selectable: z.boolean(),
  selectable_items: itemCodes,
  expected_lock_version: z.number().int().min(1),
});

const createSchema = z.object({
  base_model_id: z.uuid(),
  spec_code: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  size_code: z.string().regex(/^[1-9][0-9]{2,4}x[1-9][0-9]{2,4}$/),
  fire_selectable: z.boolean(),
  selectable_items: itemCodes,
});

const statusSchema = z.object({
  row_id: z.uuid(),
  status: z.enum(['active', 'retired']),
  expected_lock_version: z.number().int().min(1),
});

function failed(e: unknown): MatrixActionResult {
  if (e instanceof StoreError) return { ok: false, error: e.message };
  console.error('[wing] matrix action error', e);
  return { ok: false, error: '保存中にエラーが発生しました。時間をおいて再度お試しください。' };
}

/** マトリクスの変更は、シミュレーター（公開カタログ）と本体マスターの作成画面に反映する */
function refresh() {
  updateTag(CATALOG_TAG);
  revalidatePath('/admin/matrix');
  revalidatePath('/admin/base-masters');
}

export async function updateMatrixRowAction(input: unknown): Promise<MatrixActionResult> {
  const actor = await requireAdmin('/admin/matrix');
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません。' };
  try {
    const row = await (await getStore()).updateMatrixRow(actor, parsed.data);
    refresh();
    return { ok: true, row, message: '保存しました。シミュレーターと本体マスターの作成画面に反映されます。' };
  } catch (e) {
    return failed(e);
  }
}

export async function createMatrixRowAction(input: unknown): Promise<MatrixActionResult> {
  const actor = await requireAdmin('/admin/matrix');
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません。' };
  try {
    const row = await (await getStore()).createMatrixRow(actor, parsed.data);
    refresh();
    return { ok: true, row, message: '行を追加しました。' };
  } catch (e) {
    return failed(e);
  }
}

export async function setMatrixRowStatusAction(input: unknown): Promise<MatrixActionResult> {
  const actor = await requireAdmin('/admin/matrix');
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません。' };
  try {
    const row = await (await getStore()).setMatrixRowStatus(actor, parsed.data.row_id, parsed.data.status, parsed.data.expected_lock_version);
    refresh();
    return { ok: true, row, message: parsed.data.status === 'retired' ? '行を停止しました。' : '行を再開しました。' };
  } catch (e) {
    return failed(e);
  }
}
