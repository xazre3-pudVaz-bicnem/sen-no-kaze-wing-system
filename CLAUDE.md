# Wing 見積シミュレーター — プロジェクトルール

ルートの `c:\projects\CLAUDE.md`（Elite Web Agency Master System）を継承する。

## このプロジェクト固有

- 目的：折り畳み式木造コンテナ「Wing」の商品紹介＋2D画像式見積シミュレーター＋マイページ＋見積PDF＋管理画面（第一段階／予算50万円MVP）
- 表現：「購入」ではなく「見積シミュレーションを始める」「この仕様で見積を依頼する」
- 価格・権限・採番はクライアントに任せない。保存・見積はサーバー側（Supabase RPC／`LocalStore`）で再計算
- 発行済み見積（`quotes` / `quote_items`）は**スナップショット**。マスター変更で変えない
- 画像切り替えは `preview_image_rules` で管理。**存在しない完成画像を生成・代用しない**。一致なしは「未反映」表示＋管理画面警告
- マスターデータはコードに直書きしない（`lib/seed/catalog.ts` は初期投入専用）
- `DataStore`（`lib/data/store.ts`）に処理を追加したら Supabase / Local 両方に実装し、SQL 側も更新する
- ローカル検証モード（`WING_LOCAL_MODE=1`）は開発・E2E 専用。本番で有効にしない

## 検証

`npm run verify`（typecheck → lint → vitest → build）と `npm run test:e2e`（Playwright、ローカルモード）を通してから完了報告する。

## ドキュメント

仮定・不足素材・ロードマップは `docs/` に集約。価格や会社情報を変えたら `docs/assumptions.md` も更新する。
