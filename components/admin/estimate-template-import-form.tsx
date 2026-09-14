'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import {
  importEstimateTemplatesAction,
  type EstimateTemplateImportState,
} from '@/lib/actions/admin';
import { Alert, Button, Field } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

const initial: EstimateTemplateImportState = { ok: false };

/**
 * 標準見積Excelは、まず検算して「照合作業用バージョン」として保存する。
 * 商品照合が完了するまで現在のシミュレーター標準見積は変更しない。
 */
export function EstimateTemplateImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<EstimateTemplateImportState>(initial);
  const [pending, setPending] = useState(false);

  const submit = async (mode: 'preview' | 'apply') => {
    if (!file) return;
    setPending(true);
    try {
      const fd = new FormData();
      fd.set('mode', mode);
      fd.set('sheet', file);
      const next = await importEstimateTemplatesAction(initial, fd);
      setState(next);
    } catch (error) {
      setState({ ok: false, error: error instanceof Error ? error.message : '標準見積の取込に失敗しました。' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card space-y-5 p-6" data-testid="estimate-template-import">
      <div>
        <h2 className="font-semibold">標準見積Excelの取込</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Excelの4分類と金額を検算したあと、商品マスターとの照合作業用バージョンとして保存します。
          この段階では現在のシミュレーター価格は変わりません。必須商品の照合完了後に「この見積を有効にする」で切り替えます。
        </p>
      </div>

      <Field
        label="分類表見積Excel（.xlsx）"
        htmlFor="estimate-template-sheet"
        required
        hint="最初に「内容を確認する」で4分類・合計金額・商品照合候補を確認します。防火シートは今回は取り込みません。"
      >
        <input
          id="estimate-template-sheet"
          type="file"
          accept=".xlsx"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setState(initial);
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sand file:px-3 file:py-2 file:text-sm"
        />
        {file && (
          <p className="mt-1 flex items-center gap-1 text-xs text-forest">
            <FileSpreadsheet className="size-3.5" aria-hidden="true" />
            {file.name}
          </p>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!file || pending}
          onClick={() => submit('preview')}
          data-testid="estimate-template-preview"
        >
          <Upload className="size-4" aria-hidden="true" />
          {pending ? '検算中…' : '内容を確認する'}
        </Button>
        {state.preview && !state.applied && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => submit('apply')}
            data-testid="estimate-template-apply"
          >
            {pending ? '取込中…' : '商品照合用に取り込む'}
          </Button>
        )}
      </div>

      {state.error && <Alert tone="warn">{state.error}</Alert>}

      {state.preview && (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[76rem] text-sm">
              <thead className="bg-sand/60 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">本体</th>
                  <th className="px-3 py-2 font-semibold">標準見積</th>
                  <th className="px-3 py-2 font-semibold">Excelシート</th>
                  <th className="px-3 py-2 text-right font-semibold">本体</th>
                  <th className="px-3 py-2 text-right font-semibold">内外装工事</th>
                  <th className="px-3 py-2 text-right font-semibold">オプション</th>
                  <th className="px-3 py-2 text-right font-semibold">別途</th>
                  <th className="px-3 py-2 text-right font-semibold">税込合計</th>
                  <th className="px-3 py-2 font-semibold">商品照合</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {state.preview.templates.map((row) => (
                  <tr key={`${row.modelSlug}:${row.specCode}`}>
                    <td className="px-3 py-2 font-semibold">{row.modelSlug}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2 text-xs text-muted">{row.sheetName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(row.base)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(row.interiorExterior)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(row.option)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(row.sitework)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatYen(row.total)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="font-semibold text-forest">自動 {row.matching.auto}</span>
                      <span className="mx-1 text-muted">／</span>
                      <span className={row.matching.needsReview > 0 ? 'font-semibold text-danger' : 'text-muted'}>
                        要確認 {row.matching.needsReview}
                      </span>
                      <span className="mx-1 text-muted">／</span>
                      <span className="text-muted">不要 {row.matching.none}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Alert tone="info">
            自動一致はメーカー＋型番など確度の高い場合だけです。要確認の商品は、取込後の照合画面で登録済み商品から選択します。
          </Alert>

          {state.preview.ignoredSheets.some((name) => name.startsWith('【防火】')) && (
            <Alert tone="info">
              防火シートは今回の対象外として読み飛ばしました。防火仕様は別段階で実装します。
            </Alert>
          )}

          {state.preview.ignoredSheets.filter((name) => !name.startsWith('【防火】')).length > 0 && (
            <Alert tone="info" title="標準見積の対象外シート">
              <ul className="mt-1 space-y-1 text-xs">
                {state.preview.ignoredSheets
                  .filter((name) => !name.startsWith('【防火】'))
                  .map((name) => (
                    <li key={name} className="flex gap-1.5">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      {name}
                    </li>
                  ))}
              </ul>
            </Alert>
          )}

          <p className="text-xs text-muted">
            ファイル検証ID: {state.preview.sha256.slice(0, 12)}…
          </p>
        </div>
      )}

      {state.applied && (
        <Alert tone="success" title={`照合作業用に ${state.applied.imports} 件取り込みました`}>
          <p>まだシミュレーターには反映されていません。各標準見積の商品照合を確認してください。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.applied.importIds.map((id, index) => (
              <Link key={id} href={`/admin/base-breakdown/imports/${id}`} className="btn-secondary btn-sm">
                {state.applied?.names[index] ?? '標準見積'}の照合を確認
              </Link>
            ))}
          </div>
        </Alert>
      )}
    </section>
  );
}
