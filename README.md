# Wing 見積シミュレーター（千の風プロジェクト 第一段階）

折り畳み式木造コンテナ「Wing」の **商品紹介 ＋ 2D 画像式見積シミュレーター ＋ マイページ保存 ＋ 見積書 PDF ＋ 管理画面**。

- 公開サイト：トップ／商品一覧／商品詳細／シミュレーター／お問い合わせ／規約
- 会員：登録／ログイン／パスワード再設定／マイページ（保存・再編集・複製・削除・見積依頼・PDF）
- 管理：ベースコンテナ／カテゴリー／オプション（価格・画像・前提・競合）／プレビュー画像ルール（不足警告）／顧客／保存仕様／見積依頼・ステータス

## 技術

Next.js 16（App Router）/ React 19 / TypeScript / Tailwind CSS v4 / Supabase（Auth・PostgreSQL・Storage）/ Zod / @react-pdf/renderer / Vitest / Playwright

```
app/                 ルーティング（(site)=公開・会員、admin=管理、api=PDF等）
components/          ui（汎用）、layout、sections、simulator、mypage、admin、auth
lib/domain/          型・価格計算・選択ルール・画像解決（純粋関数、テスト対象）
lib/data/            DataStore インターフェース＋ Supabase 実装＋ローカル検証実装
lib/actions/         Server Actions（認証・保存・見積・管理）
lib/pdf/             見積書 PDF
lib/seed/catalog.ts  初期データ（単一ソース）
supabase/migrations/ スキーマ・関数・RLS・Storage
scripts/             seed / 管理者作成 / 画像生成
docs/                仮定一覧・不足画像一覧・ロードマップ
e2e/, tests/         Playwright / Vitest
```

## セットアップ（Supabase）

1. 依存関係

   ```bash
   npm install
   ```

2. Supabase プロジェクトを作成し、マイグレーションを適用

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push            # supabase/migrations/0001〜0005 を適用
   ```

   （ダッシュボードの SQL Editor で 0001→0005 の順に実行しても同じです）

3. 環境変数 — `.env.example` をコピーして `.env.local` を作成し、`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SITE_URL` を設定

4. 初期データ投入（モデル・オプション・画像ルール）

   ```bash
   npm run seed:supabase
   ```

5. 管理者作成

   ```bash
   npm run admin:create -- --email admin@example.com --password 'Your-Passw0rd' --name '管理者'
   ```

6. Auth 設定（Supabase ダッシュボード › Authentication）
   - **Site URL** と **Redirect URLs** に本番 URL と `http://localhost:3000` を追加（`/auth/callback` を使用）
   - メール確認を使わない場合は **Confirm email を OFF**。使う場合は SMTP を設定

7. 起動

   ```bash
   npm run dev
   ```

### テスト用アカウントの作り方

- 顧客：`/register` から登録（Confirm email OFF なら即ログイン）
- 管理者：`npm run admin:create`（既存ユーザーを指定すると管理者へ昇格）
- 管理者権限は `profiles.role_code = 'admin'`。SQL で `update profiles set role_code='admin' where email='...'` でも可

## 環境変数なしでデプロイした場合（デモモード）

Supabase の環境変数が未設定のままデプロイすると、自動的にローカル（デモ）モードで動作し、画面上部に注意バナーが出ます。
閲覧・シミュレーション・会員登録・保存・見積は動きますが、**データは一時領域（/tmp）に保存されるため、インスタンスごと・再デプロイで消えます**。本番運用には必ず Supabase を設定してください。

## ローカル検証モード（Supabase なし）

Docker や Supabase なしで全フローを動かす開発・E2E 用モードです。`.wing-local/db.json` をデータベース代わりに使います。**本番では使わないでください。**

```bash
# .env.local
WING_LOCAL_MODE=1
WING_LOCAL_ADMIN_EMAILS=admin@example.com   # このメールで登録すると管理者になる

npm run seed:local   # DB 初期化＋ customer@example.com / Wing-Demo1!、admin@example.com / Wing-Admin1! を作成
npm run dev
```

パスワード再設定はメールを送らず、画面に再設定リンクを表示します。

## テスト

```bash
npm run typecheck   # tsc
npm run lint        # eslint
npm run test        # vitest: 価格計算・選択ルール・画像解決
npm run test:e2e    # playwright: ローカルモードで完了条件 1〜15 を通しで確認（Chromium）
npm run build
```

E2E は `playwright.config.ts` がローカルモードの dev サーバー（port 3100）を自動起動します。初回は `npx playwright install chromium`。

## 主要な設計

- **価格**：`computePricing()`（`lib/domain/pricing.ts`）をブラウザ表示に使い、保存・見積時はサーバー側（Supabase は `save_configuration` / `create_quote_from_configuration` RPC、ローカルは同関数）で**必ず再計算**。見積は `quote_items` に名称・単価・数量・金額を**スナップショット**し、`guard_quote_amounts` トリガーで変更を禁止
- **採番**：`next_quote_no()`（`Q` + yyyymm + `-` + 4桁連番、`quote_sequences` で直列化）
- **権限**：RLS（本人 or `is_admin()`）。RPC は `security definer` で所有者を検証
- **画像切り替え**：`preview_image_rules`（view × キー集合 × composite/layer）。`resolvePreview()` が ①完全一致 → ②レイヤー合成 → ③最近傍＋「未反映」表示 → ④なし の順で解決し、管理画面に不足一覧を警告
- **ログイン前の選択保持**：`localStorage`（`wing:sim:<slug>`）に下書きを保存し、ログイン後 `?resume=1` で復帰して保存ダイアログを自動表示
- **SEO**：`NEXT_PUBLIC_SITE_URL` 未設定時は canonical/OGP/sitemap を出さず robots を全 Disallow。マイページ・管理画面・認証ページは noindex。Organization / Product / FAQPage / BreadcrumbList の JSON-LD

## デプロイ（Vercel）

1. リポジトリを Vercel に接続
2. 環境変数（`.env.example` の Supabase 4 項目）を設定
3. `NEXT_PUBLIC_SITE_URL` を本番 URL に設定（未設定だと noindex のまま）
4. Supabase Auth の Redirect URLs に `https://<domain>/auth/callback` を追加

## ドキュメント

- [docs/assumptions.md](docs/assumptions.md) — 仮定した価格・会社情報・要確認事項
- [docs/required-preview-assets.md](docs/required-preview-assets.md) — 不足している組み合わせ画像の仕様一覧
- [docs/roadmap.md](docs/roadmap.md) — 第二・第三段階への拡張ポイント
