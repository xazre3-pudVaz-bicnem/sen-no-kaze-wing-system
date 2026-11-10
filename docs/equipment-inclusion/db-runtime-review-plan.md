# 設備包含DB／RPC：独立レビュー・ローカル実DB試験条件

## 現状

このブランチの `proposed-schema-and-rpc.sql` は**SQL草案**であり、正式migrationではない。Supabase CLI / Docker / PostgreSQLを利用できる検証環境がないため、SQLをまだ実際のDBへ適用・実行していない。GitHub Actionsの通常CIが通っても、その事実を実DB検証済みと見なさない。

GitHubのmain、関連Open PR、mainとの差分、検証HEAD、Supabaseのmigration履歴とschemaを**適用直前にも再確認**すること。今回は本番DBのread-only確認以外は実施しない。

## 独立レビューで確認する順序

1. **権限・RLS**：`auth.uid()`／`can_edit_catalog()`／`SECURITY DEFINER` owner／`search_path=''`／`PUBLIC,anon,authenticated,service_role`のEXECUTEとテーブル直接write。特に#502が取り込まれた場合の編集権限差。
2. **保存原子性**：同じ商品を`FOR UPDATE`し、期待集合比較→削除→挿入→監査まで単一トランザクション。不一致・無効カテゴリー・監査エラー・ロックタイムアウト時のロールバック。
3. **商品削除とFK**：`ON DELETE RESTRICT`がdraft削除・published safe-deleteと整合すること。旧リンクを明示クリアせず商品が削除されないか。
4. **カテゴリー**：候補の初期案`group_code='equipment'`は未承認。現行設備カテゴリーは浴室／キッチン／洗面／トイレ／給湯／空調。照明等を含める業務判断は未確定で、このPRでは確定しない。
5. **金額・履歴**：包含設定を変えても既存`standard_estimate_revisions`・`quote_items`・`configuration_snapshots`等に更新が走らないこと。新規Draftへの反映／確定見積は別工程。
6. **既存排他2件**：移行・削除しないこと。別室追加の運用と衝突するため、後続で明示検討。
7. **直接SELECT公開**：Draft商品や未公開カテゴリーの包含関係がanonへ漏れないこと。商品マスター編集者には編集画面から見えること。
8. **監査**：保存者、前後カテゴリー配列、対象商品が残り、無変更は監査行を増やさず、失敗時には監査を残さないこと。
9. **transaction / deadlock**：カテゴリー変更と商品変更、同一商品への並行保存でlock順・2秒timeoutが妥当か。

## 使い捨てSupabase DB試験（本番では絶対に実行しない）

1. Supabase CLIで新規migrationを発行して草案を移植する（`supabase migration new <name>`）。正式なtimestampはCLIが作成したものを採用する。**既存migrationの改変は禁止**。
2. 新しい空のローカルSupabase DBへ全migrationを順番に適用。途中で失敗したら停止。
3. 各ロールで`has_table_privilege`・`has_function_privilege`を検証：anonはRPC不可、authenticatedはRPCが見えるが権限なしユーザーは拒否、service_roleには直書き・RPC EXECUTEを許さない。
4. 登録権限を持つ別々のセッションを準備し、3点ユニットバスにトイレ・洗面のcategory IDを保存→再取得→監査確認する。価格情報は変わらない。
5. 異常系：存在しないoption ID、UUID配列NULL、重複ID、自己カテゴリー、未公開カテゴリー、候補外カテゴリー、旧集合不一致を拒否。すべてデータ・監査に変更なし。
6. 競合系：2セッションが同じ商品を更新し、後続の旧集合書込みだけが拒否されること。ロック待ち時のrollback・lock_timeout・deadlockの有無を確認。
7. 既存のDraft／Published商品削除経路について、FKの`RESTRICT`による意図的停止を確認。想定外の削除／自動CASCADEは不可。
8. 匿名ユーザーにDraft商品内包設備・Draftカテゴリーの情報が漏れないことを確認する。
9. `standard_estimate_revisions`、`quote_items`、`configuration_snapshots`、既存`option_conflicts`2件の件数・内容のbefore/afterが不変であることを確認。
10. runtimeセキュリティテスト、database advisors、migration history、schema postflightを確認。独立レビュー後に初めてマージ可否を判断する。

## 実装順と停止条件

- このPRは**独立レビュー依頼用の草案**。本番DBは変更しない。
- 未確定のカテゴリー範囲・権限変更#502・FK削除挙動を、推測で採用しない。
- `supabase/migrations/`に新規ファイルを作るのはCLIが利用できてから。保存RPCの本番利用はさらに本番適用の事前承認後。
- 商品登録STEP1/STEP2の保存接続、シミュレーター、見積のDB正式計算は別PR。金額・Revision・Snapshotの独立レビューを必須とする。

## 現時点のレビュー判定

**マージ不可（独立レビュー、CLIからのmigration生成、ローカルDB runtime検証が未完了）。** SQLの内容についてレビューが終わっていないことを隠してマージしない。
