import { requireCatalogEditor } from '@/lib/auth/session';
import { AdminPage } from '@/components/admin/ui';
import { ImportForm } from '@/components/admin/import-form';

/** Excel と画像 ZIP から商品をまとめて登録する。総代理店以上 */
export default async function AdminImportPage() {
  await requireCatalogEditor();

  return (
    <AdminPage
      title="商品の一括登録"
      lead="Excel の商品マスターと画像をまとめてアップロードして、商品と選択項目（色・仕様）を一度に登録します。"
    >
      <ImportForm />

      <section className="card space-y-3 p-6 text-sm">
        <h2 className="font-semibold">Excel の作り方</h2>
        <p className="text-ink-soft">シート名で読み分けます。名前が合っていれば列の並びは多少違っても読み取ります。</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">シート名</th>
                <th className="px-3 py-2 font-semibold">必要な列</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-3 py-2 font-semibold">商品一覧</td>
                <td className="px-3 py-2 text-ink-soft">
                  商品ID／カテゴリー／メーカー／商品名／位置づけ／主なサイズ／メーカー参考価格／Wing表示価格／お客様向け短い説明／表示順
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">お客様選択項目</td>
                <td className="px-3 py-2 text-ink-soft">
                  カテゴリー／親商品ID／選択項目／表示順／選択肢／対象商品ID／区分／Wing追加価格／画像ファイル名／適用条件／備考
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">画像一覧</td>
                <td className="px-3 py-2 text-ink-soft">画像ファイル名／対象商品ID／用途（「メイン」と書くと商品の代表画像になります）</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">カテゴリー一覧</td>
                <td className="px-3 py-2 text-ink-soft">表示順／カテゴリーID／カテゴリー名</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="pt-2 font-semibold">入力のきまり</h3>
        <ul className="space-y-1.5 text-ink-soft">
          <li>・商品ID は商品を見分ける鍵です。同じ ID で取り込むと上書き、新しい ID なら追加になります。</li>
          <li>・価格は数字だけ（「584000」「584,000」「¥584,000」いずれも可）。空欄なら「別途見積」で登録します。</li>
          <li>・区分は「標準」（最初から選ばれる）／「固定」（変更できない）／それ以外は追加オプションとして扱います。</li>
          <li>・画像ファイル名は ZIP の中のファイル名と一致させてください。フォルダ分けは自由です。</li>
          <li>・カテゴリーは台帳のカテゴリーに自動で対応づけます。対応先がないものは登録せず、結果に理由を出します。</li>
        </ul>
      </section>
    </AdminPage>
  );
}
