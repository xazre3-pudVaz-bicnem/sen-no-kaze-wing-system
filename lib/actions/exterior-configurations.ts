'use server';

import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { saveConfigurationAction, type SaveResult } from './configurations';
import { saveExteriorFaces } from '@/lib/data/exterior-faces';
import { validateExteriorFaces, type ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import { saveConfigurationSchema } from '@/lib/validation';

const faceSchema = z.object({
  face_code: z.enum(['front', 'right', 'back', 'left']),
  option_id: z.uuid(),
  variant_choice_ids: z.array(z.uuid()).max(30).default([]),
});

const schema = saveConfigurationSchema.extend({ exterior_faces: z.array(faceSchema).max(4).default([]) });

/** シミュレーターの通常保存に、外壁4面の割当保存を追加する。 */
export async function saveConfigurationWithExteriorAction(input: unknown): Promise<SaveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: '保存にはログインが必要です。', code: 'UNAUTHENTICATED' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません。', code: 'VALIDATION' };

  const { exterior_faces, ...baseInput } = parsed.data;
  const store = await getStore();
  const bundle = await store.getCatalogBundle(baseInput.base_model_id, { includeDraft: false });
  if (!bundle) return { ok: false, error: '商品データを確認できませんでした。', code: 'VALIDATION' };
  const faceError = validateExteriorFaces(bundle, exterior_faces as ExteriorFaceSelection[]);
  if (faceError) return { ok: false, error: faceError, code: 'VALIDATION' };

  const result = await saveConfigurationAction(baseInput);
  if (!result.ok) return result;

  try {
    await saveExteriorFaces(result.configuration.id, exterior_faces as ExteriorFaceSelection[]);
    return result;
  } catch (error) {
    console.error('[wing] exterior face save error', error);
    return {
      ok: false,
      error: '仕様本体は保存されましたが、外壁4面の保存に失敗しました。DB更新の適用状況を確認してください。',
      code: 'INTERNAL',
    };
  }
}
