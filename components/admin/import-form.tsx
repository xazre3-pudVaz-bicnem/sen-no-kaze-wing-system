'use client';

import { useActionState, useState } from 'react';
import { FileSpreadsheet, Images, TriangleAlert, Upload } from 'lucide-react';
import { importCatalogAction, type ImportState } from '@/lib/actions/admin';
import { Alert, Button, Field } from '@/components/ui';

const initial: ImportState = { ok: false };

/**
 * 商品マスター（Excel / CSV）と画像 ZIP をアップロードして一括登録する。
 * いきなり書き込まず、まず内容を見せてから「登録する」で反映する。
 */
export function ImportForm() {
  const [state, action, pending] = useActionState(importCatalogAction, initial);
  // React 19 はフォーム送信後に入力をリセットするので、選んだファイルは自分で持っておく。
  // そうしないと「確認する」のあとの「登録する」でファイルが消える。
  const [sheet, setSheet] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);

  const submit = (mode: 'preview' | 'apply') => {
    if (!sheet) return;
    const fd = new FormData();
    fd.set('mode', mode);
    fd.set('sheet', sheet);
    if (zip) fd.set('images', zip);
    action(fd);
  };

  return (
    <div className="space-y-6" data-testid="import-form">
      <div className="card space-y-5 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="商品マスター（.xlsx / .csv）" htmlFor="sheet" required hint="「商品一覧」「お客様選択項目」「画像一覧」「カテゴリー一覧」のシートを読み取ります">
            <input
              id="sheet"
              name="sheet"
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setSheet(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sand file:px-3 file:py-2 file:text-sm"
              data-testid="import-sheet"
            />
            {sheet && (
              <p className="mt-1 flex items-center gap-1 text-xs text-forest">
                <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                {sheet.name}
              </p>
            )}
          </Field>

          <Field label="商品画像（.zip・任意）" htmlFor="images" hint="Excel の「画像ファイル名」と同じ名前のファイルを入れてください。フォルダ分けは自由です">
            <input
              id="images"
              name="images"
              type="file"
              accept=".zip"
              onChange={(e) => setZip(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sand file:px-3 file:py-2 file:text-sm"
              data-testid="import-images"
            />
            {zip && (
              <p className="mt-1 flex items-center gap-1 text-xs text-forest">
                <Images className="size-3.5" aria-hidden="true" />
                {zip.name}
              </p>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => submit('preview')} variant="secondary" disabled={pending || !sheet} data-testid="import-preview">
            <Upload className="size-4" aria-hidden="true" />
            {pending ? '読み取り中…' : '内容を確認する'}
          </Button>
          {state.preview && (
            <Button type="button" onClick={() => submit('apply')} disabled={pending} data-testid="import-apply">
              この内容で登録する
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">
          同じ商品ID のものは上書きされます。何度取り込んでも商品が増えることはありません。
          マスターから消えた商品は自動では削除しません（保存済みのお見積りが参照している場合があるため）。
        </p>
      </div>

      {state.error && <Alert tone="warn">{state.error}</Alert>}

      {state.preview && !state.applied && (
        <div className="card space-y-4 p-6" data-testid="import-preview-result">
          <div>
            <p className="font-semibold">読み取り結果：{state.preview.fileName}</p>
            <p className="mt-1 text-sm text-ink-soft">
              商品 {state.preview.products} 件／選択項目 {state.preview.variantGroups} 件／選択肢 {state.preview.variantChoices} 件／
              画像 {state.preview.imagesUploaded} 件
            </p>
          </div>

          {state.preview.sample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-sand/60 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">商品</th>
                    <th className="px-3 py-2 font-semibold">カテゴリー</th>
                    <th className="px-3 py-2 font-semibold">価格</th>
                    <th className="px-3 py-2 font-semibold">選べる項目</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.preview.sample.map((r) => (
                    <tr key={r.name}>
                      <td className="px-3 py-2 font-semibold">{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.category}</td>
                      <td className="px-3 py-2 tabular-nums">{r.price}</td>
                      <td className="px-3 py-2 text-xs text-ink-soft">{r.variants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.preview.products > state.preview.sample.length && (
                <p className="mt-2 text-xs text-muted">ほか {state.preview.products - state.preview.sample.length} 件</p>
              )}
            </div>
          )}

          {state.preview.warnings.length > 0 && (
            <Alert tone="warn" title={`確認してほしい点：${state.preview.warnings.length} 件`}>
              <ul className="mt-1 space-y-1 text-xs">
                {state.preview.warnings.slice(0, 12).map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    {w}
                  </li>
                ))}
                {state.preview.warnings.length > 12 && <li>ほか {state.preview.warnings.length - 12} 件</li>}
              </ul>
            </Alert>
          )}
        </div>
      )}

      {state.applied && (
        <div className="card space-y-3 p-6" data-testid="import-applied">
          <Alert tone="success" title="登録しました">
            新規 {state.applied.createdProducts} 件／更新 {state.applied.updatedProducts} 件／
            選択項目 {state.applied.variantGroups} 件／選択肢 {state.applied.variantChoices} 件／画像 {state.applied.imagesLinked} 件
          </Alert>
          {state.applied.skipped.length > 0 && (
            <Alert tone="warn" title={`登録しなかったもの：${state.applied.skipped.length} 件`}>
              <ul className="mt-1 space-y-1 text-xs">
                {state.applied.skipped.slice(0, 10).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
