# コラム（/column）の運用手順

お知らせ（`/news`）とは別機能です。お知らせは会社からの告知、コラムは検討者の疑問に答える読み物として役割を分けています。相互に記事を混ぜないでください。

## 1. 置き場所

| 対象 | パス | 用途 |
| --- | --- | --- |
| 記事 | `content/column/<slug>.md` | Markdown＋frontmatter。Git 管理 |
| 記事計画 | `content/column-plan.json` | 30日分のテーマ。自動投稿はここから選ぶ |
| 確認済み情報 | `content/column-facts.json` | 記事の根拠。`confirmed` だけ断定してよい |
| 自動投稿の設定 | `content/column-autopost.json` | 停止スイッチ・モデル ID・上限値 |
| 実行ログ | `docs/column-log.md` | 成功・見送り・失敗の記録（自動追記） |

Supabase のスキーマ・RLS・商品データは今回の追加で一切変更していません。

## 2. 自動投稿の動き

1. `content/column-plan.json` から `status: planned` かつ `auto: true` のテーマを上から選ぶ
2. `content/column-facts.json` の該当する事実と、既存記事の**タイトル・要約だけ**を読み込む（本文は渡さないのでトークンを抑えられる）
3. Claude Haiku で本文を生成
4. 機械的な検証（出典の有無・文字数・見出し数・禁止表現・リンク先・slug 重複・テーマ重複）
5. 合格したものだけ `content/column/` に保存。専門判断が必要な語（建築確認・旅館業・民泊・補助金・税・利回りなど）を含む場合は `status: draft` にして人の確認へ回す
6. 型チェック・テスト・ビルドを実行
7. 通ったら GitHub へコミット＆プッシュ
8. 既存の Vercel 連携で自動デプロイ

**AI の自己採点では合格にしません。** 判定は `lib/column/validate.ts` の機械的な条件だけで行います。

### 実行時刻

GitHub Actions の cron `17 0 * * *`（UTC）＝ **日本時間 9:17 頃**。
GitHub Actions の cron は混雑状況により数分〜数十分遅れることがあり、**定刻実行は保証されません**。

## 3. 操作方法

### 手動で実行する

1. GitHub の対象リポジトリ → **Actions** タブ
2. 左メニューの **コラム自動投稿** を選ぶ
3. 右上の **Run workflow** ボタン
4. 必要なら入力欄を設定して **Run workflow**

| 入力 | 意味 |
| --- | --- |
| `dry_run` | チェックすると生成だけ行い、ファイルを書かずコミットもしない |
| `slug` | 計画の特定テーマを指定（空なら自動選択） |
| `model` | モデル ID を一時的に上書き |

### 自動投稿を止める

どちらか一方で止まります。

- **すぐ止める**：GitHub → Settings → Secrets and variables → Actions → **Variables** タブ → `COLUMN_AUTOPOST` を `off` にする
- **リポジトリ側で止める**：`content/column-autopost.json` の `"enabled": false` にしてコミット

再開はそれぞれ `off` を消す／`true` に戻すだけです。

### モデルを変える

`content/column-autopost.json` の `model` を書き換えます。既定は `claude-haiku-4-5-20251001`。
**指定したモデルが使えない場合、スクリプトは別モデルへ勝手に切り替えず失敗として終了します。**

### ローカルで試す

```bash
# 生成だけ試す（ファイルを書かない）
ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-column.ts --dry-run

# テーマを指定
ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-column.ts --slug seaside-installation-points --dry-run
```

## 4. 安全のための制限

- 書き込むのは `content/column/`、`content/column-plan.json`、`docs/column-log.md` のみ。固定ページ・商品データ・認証設定・環境変数には触れません
- 生成された Markdown は HTML として実行せず、許可したノード（見出し・段落・箇条書き・表・引用・強調・リンク）だけを React 要素に変換して描画します（`lib/column/markdown.ts`）
- リンクは内部パスと許可ホストの https のみ。`/admin` `/mypage` などへのリンクは弾きます
- slug は `[a-z0-9-]` のみ。パス経由の書き込みを防ぎます
- 同日に自動投稿済みなら再実行してもスキップします
- `concurrency: daily-column` で同時実行しません
- API エラーは最大3回まで再試行し、失敗時はファイルを書かずに終了します（既存サイト・既存記事は変更されません）

## 5. 品質が足りない日

生成物が検証に落ちた場合は**公開せず見送り**、理由を `docs/column-log.md` に残します。無理に公開しません。

専門判断が必要な記事（法令・税・収益性）は `status: draft` で保存されます。下書きは一覧・本文・sitemap のどこにも出ません。公開する場合は、一次資料を確認して本文を直したうえで frontmatter の `status` を `published` に変え、`sources` に確認した資料と確認日を追記してください。

**注意書きを付けるだけで不確かな本文を公開しないでください。**

## 6. 記事計画が尽きたら

`content/column-plan.json` の `items` に追記します。1件あたり次を必ず埋めてください。

- `slug`（英小文字とハイフン、既存と重複しない）
- `title` / `category`（`lib/column/types.ts` の 5 分類から選ぶ）
- `question`（読者の疑問）
- `difference`（既存記事との違い。同じ検索意図の記事を増やさないため）
- `facts`（`content/column-facts.json` の id。`confirmed` が1件以上必要）
- `links`（本文から張る固定ページ）
- `auto`（法令・税・収益性を扱うなら必ず `false`）

同じテーマの記事を増やすのではなく、**既存記事の改善**を優先してください。

## 7. 事実台帳の更新

`content/column-facts.json` は、商品情報や会社情報が変わったら更新します。各項目に `source`（出典）、`checkedAt`（確認日）、`status`（`confirmed` / `needs-check`）を持たせてください。

古い情報・矛盾する情報は `needs-check` にします。現在 `needs-check` にしているもの：

- BOX・Flat の寸法（トップページと商品台帳の表記が一致していない）
- 価格（マスター更新で変わるため本文に書かない）
- 能登のモデルハウス（開設予定日が過去で現況が未確認）
- 施工実績（公開情報として確認できるものが無い）
- 法令・税・収益性（条件によって判断が変わる）

## 8. Search Console での確認

1. [Search Console](https://search.google.com/search-console) に `https://www.sen-no-kaze.com/` のプロパティが登録されていることを確認
2. **サイトマップ** に `https://www.sen-no-kaze.com/sitemap.xml` を送信（コラムは自動で含まれます）
3. 数日後、**検索結果 → ページ** で `/column/` を含む URL のフィルタを作る

見るのは投稿本数ではなく次の3点です。

- コラム経由の**表示回数・クリック数**（検索結果 → ページのフィルタ `/column/`）
- コラムから**商品ページ・シミュレーターへの遷移**（既存の計測があればそこで確認）
- **問い合わせへの貢献**（問い合わせ時の流入元）

計測タグは既存のものを使い、二重設置や個人情報の送信をしないでください。

## 9. 費用の目安

1記事あたりの実測値（モックによる計測ベース、入力約1,900・出力約1,400トークン）で試算すると、Claude Haiku 4.5 の料金（入力 $1 / 出力 $5 per MTok）では次のとおりです。

- 1記事：入力 0.0019 MTok × $1 ＋ 出力 0.0014 MTok × $5 ≒ **$0.0089（約1.3円）**
- 月30記事：**約 $0.27（約40円）**

再試行や見送りを含めても月$1未満に収まる見込みです。記事数を増やしたり、渡す情報を増やすと比例して増えます。

## 10. 未対応（設定が必要な項目）

### canonical が vercel.app を指している（コラム以外にも影響）

現在 `NEXT_PUBLIC_SITE_URL` が `https://sen-no-kaze-wing-system.vercel.app` のため、`https://www.sen-no-kaze.com/` で表示しても canonical・OGP・sitemap が vercel.app を指します。**カスタムドメインが正規URLとして評価されない状態**です。

対応（Vercel の設定変更のみ。コード修正は不要）:

1. Vercel → プロジェクト `sen-no-kaze-wing-system` → **Settings** → **Environment Variables**
2. `NEXT_PUBLIC_SITE_URL` を `https://www.sen-no-kaze.com` に変更（Production）
3. **Deployments** → 最新 → **Redeploy**

変更後、既存ページとコラムの canonical・OGP・sitemap がすべて www.sen-no-kaze.com になります。

### 自動投稿に必要な設定

1. GitHub → Settings → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `ANTHROPIC_API_KEY` / Value: Anthropic コンソールで発行した API キー
2. GitHub → Settings → **Actions** → **General** → **Workflow permissions**
   - 「Read and write permissions」を選択（自動コミットを push するため）
