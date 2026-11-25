import { describe, expect, it } from 'vitest';
import {
  restoreMatrixSettingsDrafts,
  serializeMatrixSettingsDrafts,
  type MatrixSettingsDraftCache,
} from '@/lib/domain/matrix-settings-draft-cache';

const row = {
  id: 'matrix-row-1',
  lock_version: 3,
  fire_selectable: true,
  selectable_items: ['bath', 'sash'],
};

describe('商品選択設定：未保存マトリクスの画面間保持', () => {
  it('詳細編集へ遷移して画面が再生成されても、未保存のチェックと選択行を復元できる', () => {
    const draft: MatrixSettingsDraftCache = {
      selectedId: row.id,
      drafts: { [row.id]: { fire: false, items: ['sash'], lockVersion: 3 } },
    };
    const saved = serializeMatrixSettingsDrafts(draft);
    expect(restoreMatrixSettingsDrafts(saved, [row])).toEqual(draft);
  });

  it('別の画面で行が更新された場合、旧版の未保存ドラフトと版番号を維持する', () => {
    const draft: MatrixSettingsDraftCache = {
      selectedId: row.id,
      drafts: { [row.id]: { fire: false, items: ['sash'], lockVersion: 3 } },
    };
    const newServerRow = { ...row, lock_version: 4 };
    const restored = restoreMatrixSettingsDrafts(serializeMatrixSettingsDrafts(draft), [newServerRow]);
    expect(restored.drafts[row.id]?.lockVersion).toBe(3);
    expect(restored.drafts[row.id]?.items).toEqual(['sash']);
  });

  it('もう差分がない保存済みドラフト・他の行・破損した値は復元しない', () => {
    const saved = serializeMatrixSettingsDrafts({
      selectedId: 'missing-id',
      drafts: {
        [row.id]: { fire: true, items: ['bath', 'sash'], lockVersion: 3 },
        'missing-id': { fire: false, items: [], lockVersion: 2 },
      },
    });
    expect(restoreMatrixSettingsDrafts(saved, [row])).toEqual({ selectedId: '', drafts: {} });
    expect(restoreMatrixSettingsDrafts('invalid-json', [row])).toEqual({ selectedId: '', drafts: {} });
    expect(restoreMatrixSettingsDrafts(JSON.stringify({ version: 1, drafts: { [row.id]: { fire: 'no', items: [], lockVersion: 3 } } }), [row])).toEqual({ selectedId: '', drafts: {} });
  });
});
