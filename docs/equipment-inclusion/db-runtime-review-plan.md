# 設備包含DB／RPC｜確定仕様・検証・独立再レビュー

## 適用対象と本番境界

PR #628 の新規migrationは `supabase/migrations/20261110024245_option_included_categories.sql`。ファイル名はSupabase CLIで生成したもの。**Draft PR・未マージ・本番DB未適用**。既存の適用済みmigrationは編集しない。main・open PR・Supabase本番状態・CIの確認はレビュー開始時とマージ直前にliveで再実施する。

## 2026-11-10確定の業務仕様

- **包含元の商品カテゴリーは `option_categories.code='ub'` だけ**（浴室）。
- **包含先は `toilet`（トイレ）・`washbasin`（洗面）だけ**。その他の設備グループ、キッチン、照明などは対象外。
- 3点ユニットバスとシャワートイレユニットの**商品ごと**に、実際に含む設備だけを選んで保存する。0件・トイレのみ・洗面のみ・両方を区別。全UB商品へ自動付与しない。
- **商品削除は従来の安全削除条件を満たした場合のみ**。既存 `options_delete_reference_guard`／`assert_option_unreferenced()` が使用中商品を拒否する。削除が成立した場合、`option_id ON DELETE CASCADE` により、その商品の包含関係も**同一トランザクション**で削除。
- 包含先の`included_category_id`は `ON DELETE RESTRICT` とし、参照中のカテゴリー自体を誤って削除しない。
- 商品`category_id`の変更時、包含設定が1件でも残っていればDBトリガーで変更を拒否する。まず本部が包含設定をクリアする必要がある。
- Published Revision・Quote・発行済Snapshotは不変。live商品マスターの包含設定をもって過去の正式金額を再計算しない。

## SQL設計

- `option_included_categories(option_id, included_category_id, created_at)`、複合PK、両側FK。保存開始前の段階で空テーブル（既存排他2件は維持）。
- `set_option_included_categories(option_id, expected_ids, next_ids)` は本部rank3＋`can_edit_catalog()`のみ許可。サービス・匿名・総代理店からは使用不可。正当性チェック→商品行 `FOR UPDATE`→旧集合比較→入替→監査を原子的に実行。
- `next_ids` は新規指定分も既存保持分も `toilet`／`washbasin` のpublishedカテゴリー以外は拒否。変更対象の商品のカテゴリは `ub` であること。変更先は商品ごとに明示指定し、初期defaultや自動推論は作らない。
- `guard_option_inclusion_category_change()` はカテゴリー変更の入口で確認し、包含関係が残る間は更新しない。
- SELECT RLS: Published商品とPublished対象カテゴリーの情報のみ非ログインへ許可。本部rank3はDraft包含設定も読める。総代理店rank2はDraftを読めない。
- `SECURITY DEFINER` のowner / search_path / EXECUTEを明示し、内部トリガー関数のPUBLIC EXECUTEを剥奪する。

## 使い捨てDBで検証すること（本番変更は禁止）

1. `supabase/migrations` の全SQLを使い捨てローカルSupabaseに順番適用し、既存履歴との互換とPostflightを確認。
2. 初期データが空の場合だけ `ub`、`toilet`、`washbasin`、`kitchen` を検証用に生成。元から存在するときは既存IDを使い、商品ごとに期待した関連を登録。検証データはROLLBACK／専用cleanup。
3. 3点UBにトイレ・洗面、シャワートイレユニットにトイレだけを登録し、個別保存／無変更時監査／登録されない洗面を確認。
4. 商品が `ub` 以外、包含先が `kitchen`、存在しないUUID・重複・NULL・Draft対象・自己カテゴリーの場合は保存拒否。
5. anon／dealer／master_dealer／service_roleのRPC拒否、admin(rank3)保存、Draftの非公開、SQLの直接write権限制限。
6. 未使用Draftの通常商品DELETE、未使用Publishedの `delete_unused_published_option()` を**正規入口**で実行。従来の安全削除ガードに失敗する商品の削除・包含関係削除がともに拒否されること。条件を満たす商品の削除時には関連が同じtransactionで消えること。
7. 包含中のカテゴリー自体は削除できないこと（FK `RESTRICT`）。商品カテゴリーの `ub` から別カテゴリへの変更は包含が残る限り禁止し、合法的なクリア→変更では成功すること。
8. 同一商品の2セッション競合で後続の古い保存が失敗すること、カテゴリー変更との競合でDB整合性が破れないこと、監査は成功時のみ増えること。
9. SQL差分に既存 `option_conflicts`、Quote、見積Revision、SnapshotへのDMLがないことを確認。既存商品削除ガード自体を変更しない。
10. ローカルruntime security / ACL・RLSのテスト結果、CI Verify、DB Rehearsal、advisors、未検証事項をまとめ、別担当の独立再レビューを実施。

## 工程管理と停止条件

- PR #502、#535、#563、#616、#618など他PRのmigrationを飛び越えて本番へ適用しない。pending順序・DB preflight／dry-run・バックアップ/PITR・本番postflightは業者さん担当。
- STEP1/STEP2保存接続、シミュレーターの別室設置／重複選択、正式金額とRevision pin／Snapshotの再現は**別PR**。
- レビューがHighを残している場合はDraftで保持。使い捨てDB試験成功だけでマージ可とはしない。
- 本番DBへのDDL/DML・migration適用、マージ、未承認の他機能修正は行わない。

**現在の判定：独立再レビューと修正後CI確認までマージ不可。**
