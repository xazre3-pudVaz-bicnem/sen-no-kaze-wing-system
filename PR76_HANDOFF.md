# PR #76 Codex WIP 引継ぎ

## 対象

- リポジトリ: `xazre3-pudVaz-bicnem/sen-no-kaze-wing-system`
- 元PR: [#76 標準見積Excelの商品マスター照合を追加](https://github.com/xazre3-pudVaz-bicnem/sen-no-kaze-wing-system/pull/76)
- 元ブランチ: `work/estimate-product-matching-20260911`
- 元HEAD: `033400c2d569ca4c119b5c86113b81afda917921`
- 保存先WIPブランチ: `handoff/pr76-codex-wip-20260914`
- 仕様の正本: ユーザー提示の「PR #76 修正仕様書」

このWIPは途中成果の保全用であり、PR #76へは未反映です。migrationの本番Supabase適用、PRのマージ、mainへの反映、本番デプロイは行っていません。

## 変更ファイル

- `app/admin/base-breakdown/imports/[id]/page.tsx`
- `components/admin/estimate-import-review.tsx`
- `components/simulator/simulator-app.tsx`
- `lib/actions/admin.ts`
- `lib/data/local-db.ts`
- `lib/data/local-store.ts`
- `lib/data/store.ts`
- `lib/data/supabase-store.ts`
- `lib/domain/estimate-product-matching.ts`
- `lib/domain/standard-estimate-pricing.ts`
- `lib/domain/types.ts`
- `lib/import/estimate-template-import.ts`
- `tests/estimate-product-matching.test.ts`
- `tests/standard-estimate-pricing.test.ts`
- `supabase/migrations/20260914090000_estimate_import_matching_hardening.sql`（新規）
- `PR76_HANDOFF.md`（本書）

## 完了している変更

以下はTypeScript実装まで入り、typecheck・unit tests・buildが成功している。

- 自動一致をメーカー＋型番の厳格一致かつ一意候補に限定
- model/spec/category/publishedを候補絞り込みへ追加
- `line_fingerprint_v2` と `rule_match_key_v2` を分離
- 同一取込内で重複するrule keyへの保存ルール自動適用を抑止（ローカル実装）
- `source_row_json` に対象Excelセルの原値を保持
- 取込4分類を `EstimateImportSection` として正規化
- baseline item型にquantity、slot、section、source lineを追加
- ローカル有効化処理で正規化データから標準見積を再構築
- TypeScript価格計算でbaseline itemのquantity/slot/sectionを使用
- 外壁baselineの `front/right/rear/left` 4slot化と、画面側の既存 `back` との変換
- baselineと現選択一致、quantity=2、外壁4面、外壁1面変更、section継承、価格変更後の標準額維持に関するunit test追加
- 防火仕様の自動カテゴリ推論とoptional自動分類を削除
- 有効化前の2段階確認UIを追加

## 途中の変更

- 新規hardening migrationには、正規化テーブル、RLS、共通適格性関数、advisory lock、activated partial unique index、RPC再定義を記述済み。
- SupabaseStoreは新しいsection/baselineテーブルを取得するよう変更済み。
- SQL側のbaseline集計は暗黙の「外壁×4」を廃止し、明示quantityとsectionを使う案を記述済み。
- SQL有効化は `template_payload` ではなく、import/section/line/linkからpayloadを再構築する案を記述済み。

ただし、上記SQLはローカルDBへ適用しておらず、構文・型・既存データ移行・RPC実動作は未確認である。完成実装として扱わないこと。

## 未完了の変更

- Supabase migrationのclean DBおよび既存migration適用済みDBでの検証
- 仕様書にある18項目のSQL/RPC統合テスト作成・実行
- 同時取込と同時有効化の実コンカレンシーテスト
- RLS、RPC、EXECUTE権限、`SECURITY DEFINER` の実DB監査
- DB側の保存、再計算、見積発行、表示、PDFの金額一致確認
- `base` sectionに商品baselineが入った場合のDB差額反映
- Wing / BOX / Flatおよび全仕様の実データ検証
- 既存取込データ・既存標準見積のbackfill検証
- PR #76への反映前の第三者レビュー

## 新規migration

`supabase/migrations/20260914090000_estimate_import_matching_hardening.sql`

主な内容:

- `estimate_import_lines` にv2キーと `source_row_json` を追加
- `product_match_rules` に `rule_match_key_v2` を追加
- `estimate_import_sections` を追加
- `estimate_template_baseline_items` を追加
- 同一model/specでactivatedを1件に制限するpartial unique index
- `is_option_eligible_for_estimate` を追加
- import作成、ready再判定、手動照合、有効化、baseline置換RPCを再定義
- model/spec単位のtransaction advisory lock
- baseline/currentの商品マスターsection集計関数を再定義

このmigrationは本番にもローカルSupabaseにも未適用である。

## baseline構造の変更

`baseline_option_ids` は互換値として残し、正本候補を `estimate_template_baseline_items` へ移す実装途中である。baseline itemは以下を持つ。

- `option_id`
- `category_id`
- `quantity`
- `slot_key`
- `section_code`
- `source_import_line_id`
- `sort_order`

ローカル有効化では、singleカテゴリの複数商品を拒否し、multiカテゴリは行単位、外壁は4slotとして生成する。SQL側にも同等ロジックを記述したが未検証。

## 外壁4面対応の変更

- baselineでは `front/right/rear/left` を保存する案。
- 既存シミュレーターの `ExteriorFaceCode` は `front/right/back/left` のため、読込時と価格比較時に `rear` と `back` を変換する。
- TypeScript unit testでは4面標準時の差額0円と、1面変更時の1面分差額を検証済み。
- SQL/RPC経路、既存データbackfill、見積発行スナップショットは未検証。

## template_payload依存解消の進捗

- ローカル有効化は `template_payload` を使用せず、`estimateImports`、`estimateImportSections`、`estimateImportLines`、confirmed linkから再構築する。
- SQL有効化RPCにも同じ再構築処理を記述済み。
- `template_payload` は監査用スナップショットとして残している。
- SQLで「payload改変が有効化結果へ影響しない」統合テストは未作成・未実行。

## 商品適合判定の進捗

- ローカル実装ではoption/category published、category一致、globalまたはmodel一致、spec一致を確認する。
- DB migrationには共通関数 `is_option_eligible_for_estimate` を追加し、自動照合、保存ルール再利用、手動照合、ready判定、有効化直前で呼ぶ構成を記述した。
- UI側も現在の商品状態を見て未解決件数を表示する。
- DBでの商品非公開化後、model/spec/category不一致の実RPCテストは未実行。

## 有効化処理の進捗

- ローカル実装は1回のJSON DB mutation内で再検証、テンプレート置換、旧activatedのsuperseded化、新activated化を行う。
- SQL実装案はmodel/spec advisory lockとpartial unique indexを追加し、正規化データからテンプレートとbaselineを再構築する。
- SQLの原子性、競合時挙動、失敗時に旧テンプレートが維持されることは未検証。

## UI変更

有効化を即時submitせず、「有効化内容を確認」から次の内容を確認して確定する2段階UIへ変更した。

- モデル、仕様、version
- 現在有効な金額とversion
- 新しい金額、差額
- 商品リンク件数、変更リンク、未解決件数
- 旧versionの場合の警告

画面の目視・E2E確認は未実施。

## 実行したテストと結果

2026-09-14、WIPブランチ作成後、追加修正をせず実行した。

- `npm run typecheck`: 成功
- `npm run test`: 成功（21 test files、150 tests）
- `npm run verify`: 成功
  - typecheck: 成功
  - lint: 成功（ESLint warningなし）
  - test: 成功（21 test files、150 tests）
  - build: 成功（Next.js 16.3.1）
- `git diff --check`: whitespace errorなし

buildでは既存の `lib/data/local-db.ts:92` に対するTurbopack警告が1件出た。動的filesystem accessによりプロジェクト全体がtrace対象になるという警告で、今回の変更に対する修正は行っていない。

## 未実行のDB/RPC統合テスト

Supabase CLIは `node_modules` に同梱されていなかった。`npx supabase` はパッケージ取得待ちとなり、Dockerコマンドも確認できなかったため、無理に環境構築せず未実行とした。

仕様書記載の18項目（required未照合、非公開、model/spec/category不一致、非公開化後、single複数、外壁4面、quantity=2、rule key重複、型番部分一致、payload改変、同時取込、同時有効化、rollback、差額不変条件等）はDB/RPC経路では未検証。

## 既知のエラー・警告

- typecheck、lint、unit tests、buildの失敗はなし。
- buildに上記Turbopack filesystem tracing警告が1件あり。
- Git実行時にユーザー共通ignore `C:\Users\owner\.config\git\ignore` へのアクセス拒否警告が出る。リポジトリ差分の取得・commit対象判定には影響していない。
- 対象ファイルにはGitのLFからCRLFへの変換予告が出る。
- hardening migrationは未適用・未構文検証のため、潜在的なSQLエラーが残る可能性がある。

## 業者側で最初にレビューすべきポイント

1. hardening migrationをclean DBと既存PR migration適用済みDBの両方へ適用できるか。
2. SQL有効化が `template_payload` に依存せず、失敗時に旧テンプレートとactivated状態を完全に維持するか。
3. TypeScript計算とDBの `recalculate_configuration` / `create_quote_from_configuration` がquantity、default variant、section、外壁slotを同じ規則で扱うか。
4. `base` sectionへ商品baselineが入る場合、DB側の差額が保存・見積明細へ反映されるか。現行DB関数は主に内外装・option・siteworkを扱うため要確認。
5. `rear`（baseline）と `back`（既存シミュレーター）の変換境界が保存・再計算・見積発行・PDFですべて一致するか。
6. single/multiカテゴリ、同一カテゴリ複数行、quantity集約、slot keyの設計が実Excelと将来発注要件に合うか。
7. strict auto matchのTypeScript判定とSQL側再検証が同じ正規化規則になっているか。
8. RLS、公開範囲、RPCのEXECUTE権限、`SECURITY DEFINER` と `search_path` が安全か。既存関数呼出しも含めて確認すること。
9. 仕様書の18項目をSQL/RPC統合テストとして実装し、同時実行ケースを実DBで確認すること。
10. UIを実ブラウザで確認し、旧version警告、変更リンク表示、二段階確定、エラー復帰が運用上十分か。
