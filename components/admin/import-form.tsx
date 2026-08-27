'use client';

import { useState } from 'react';
import { FileSpreadsheet, Images, TriangleAlert, Upload } from 'lucide-react';
import { importCatalogAction, type ImportState } from '@/lib/actions/admin';
import { Alert, Button, Field } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import {
  duplicateBasenames,
  extractZipEntry,
  imageEntries,
  listZipEntries,
  MAX_IMAGE_BYTES,
  validateImageEntries,
  type BrowserZipEntry,
} from '@/lib/import/browser-archive';
import { catalogImportUploadPath } from '@/lib/import/catalog-import-images';

const initial: ImportState = { ok: false };

/**
 * 商品マスター（Excel / CSV）と画像 ZIP をアップロードして一括登録する。
 * いきなり書き込まず、まず内容を見せてから「登録する」で反映する。
 */
export function ImportForm({ localMode = false }: { localMode?: boolean }) {
  const [state, setState] = useState<ImportState>(initial);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  // React 19 はフォーム送信後に入力をリセットするので、選んだファイルは自分で持っておく。
  // そうしないと「確認する」のあとの「登録する」でファイルが消える。
  const [sheet, setSheet] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);

  const readArchive = async (): Promise<{ buffer: ArrayBuffer; entries: BrowserZipEntry[] } | null> => {
    if (!zip) return null;
    setProgress('画像を確認中…');
    const buffer = await zip.arrayBuffer();
    const entries = imageEntries(listZipEntries(buffer));
    validateImageEntries(entries);
    const duplicates = duplicateBasenames(entries);
    if (duplicates.length) throw new Error(`ZIP 内に同名画像があります: ${duplicates.join('、')}`);
    return { buffer, entries };
  };

  const cleanup = async (uploaded: string[]) => {
    if (!uploaded.length) return;
    if (localMode) {
      const response = await fetch('/api/admin/catalog-import/images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: uploaded }),
      });
      const { failed = uploaded.length } = response.ok ? await response.json() as { failed?: number } : {};
      if (failed) throw new Error(`未使用画像 ${failed} 件を削除できませんでした。`);
      return;
    }
    const { error } = await createClient().storage.from('product-images').remove(uploaded);
    if (error) throw new Error(`未使用画像を削除できませんでした: ${error.message}`);
  };

  const submit = async (mode: 'preview' | 'apply') => {
    if (!sheet) return;
    setPending(true);
    setState((current) => ({ ...current, error: undefined, applied: undefined }));
    const uploaded: string[] = [];
    try {
      const archive = await readArchive();
      const metadata: { name: string; path?: string; url?: string }[] = [];
      if (archive && mode === 'apply') {
        setProgress('画像を展開中…');
        const supabase = localMode ? null : createClient();
        const user = localMode ? null : (await supabase!.auth.getUser()).data.user;
        if (!localMode && !user) throw new Error('ログイン状態を確認できませんでした。');
        const sessionId = crypto.randomUUID();
        for (let i = 0; i < archive.entries.length; i++) {
          const entry = archive.entries[i];
          setProgress(`画像アップロード中 ${i + 1} / ${archive.entries.length}`);
          const bytes = await extractZipEntry(archive.buffer, entry);
          if (bytes.byteLength !== entry.size || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`画像「${entry.name}」の展開サイズが不正です。`);
          const base = entry.name.split('/').pop() ?? entry.name;
          const ext = base.split('.').pop()?.toLowerCase() ?? 'jpg';
          const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'avif' ? 'image/avif' : 'image/jpeg';
          if (localMode) {
            const formData = new FormData();
            const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            formData.set('file', new File([body], base, { type: contentType }));
            formData.set('sessionId', sessionId);
            formData.set('index', String(i));
            const response = await fetch('/api/admin/catalog-import/images', { method: 'POST', body: formData });
            const result = await response.json() as { url?: string; error?: string };
            if (!response.ok || !result.url) throw new Error(result.error ?? `画像「${base}」を保存できませんでした。`);
            uploaded.push(result.url);
            metadata.push({ name: base, url: result.url });
          } else {
            const path = catalogImportUploadPath(user!.id, sessionId, i, base);
            const { error } = await supabase!.storage.from('product-images').upload(path, bytes, { contentType, upsert: false });
            if (error) throw new Error(`画像「${base}」を保存できませんでした: ${error.message}`);
            uploaded.push(path);
            metadata.push({ name: base, path });
          }
        }
      } else if (archive) {
        metadata.push(...archive.entries.map((entry) => ({ name: entry.name.split('/').pop() ?? entry.name })));
      }
      setProgress(mode === 'apply' ? '商品登録中…' : 'Excel を解析中…');
      const fd = new FormData();
      fd.set('mode', mode);
      fd.set('sheet', sheet);
      fd.set('imageMetadata', JSON.stringify(metadata));
      const next = await importCatalogAction(initial, fd);
      if (!next.ok && uploaded.length) {
        try { await cleanup(uploaded); }
        catch (cleanupError) {
          next.error = `${next.error ?? '一括登録に失敗しました。'} ${cleanupError instanceof Error ? cleanupError.message : '未使用画像を削除できませんでした。'}`;
        }
        uploaded.length = 0;
      }
      setState(next);
      setProgress(next.ok && mode === 'apply' ? '完了' : '');
    } catch (error) {
      let message = error instanceof Error ? error.message : '一括登録に失敗しました。';
      try { await cleanup(uploaded); }
      catch (cleanupError) { message += ` ${cleanupError instanceof Error ? cleanupError.message : '未使用画像を削除できませんでした。'}`; }
      setState({ ok: false, error: message });
      setProgress('');
    } finally {
      setPending(false);
    }
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
              onChange={(e) => { setSheet(e.target.files?.[0] ?? null); setState(initial); setProgress(''); }}
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
              onChange={(e) => { setZip(e.target.files?.[0] ?? null); setState(initial); setProgress(''); }}
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
              {pending ? progress || '処理中…' : 'この内容で登録する'}
            </Button>
          )}
        </div>
        {progress && <p className="text-sm font-semibold text-forest" role="status" aria-live="polite">{progress}</p>}
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
          {state.applied.warnings.length > 0 && (
            <Alert tone="warn" title={`確認してほしい点：${state.applied.warnings.length} 件`}>
              <ul className="mt-1 space-y-1 text-xs">
                {state.applied.warnings.slice(0, 12).map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    {w}
                  </li>
                ))}
                {state.applied.warnings.length > 12 && <li>ほか {state.applied.warnings.length - 12} 件</li>}
              </ul>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
