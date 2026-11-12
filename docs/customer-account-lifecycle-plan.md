# 顧客アカウントの退会・会員削除：実装境界と未確定事項

基点：GitHub main cdb25f82cc857fd7a50a8ffcac32136fa05edaec（実装開始時点）。これは現在値として再利用しないこと。
対象：お客様自身の退会 / 本部管理者による顧客アカウント削除。選択肢の削除PR #578とは別工程。

## 確認した既存機能
- /mypage/profile：本人のプロフィール変更のみ
- /admin/customer-management/[id]：顧客詳細は参照専用。admin / master_dealer / dealer に閲覧範囲あり
- /admin/customers：管理者の担当者・権限管理（顧客アカウントも一覧表示可）
- Supabase Auth と public.profiles を使用。案件・Configuration・Quote・Snapshot・電子契約などと会員IDが関連する
- 本番Supabaseへのread-onlyアクセスは権限エラー。migration history / 本番FK / データ量は未確認

## 今回のUI・Actionの位置づけ（ドラフト）
- マイページ「登録情報の変更」→「退会手続き」→「退会申請」。
- 管理者だけ、顧客詳細の折り畳み「会員アカウントの操作」→「未使用会員を削除」。
- Server Actionは本人またはadmin、対象customer確認、別人ID改ざん防止、confirmを検証。
- バックエンドRPCがない間は失敗として表示し、退会・削除したと偽らない。
- 今回、認証ユーザー・顧客profile・過去の見積・契約等は一切削除しない。

## 未実装のRPC契約
- request_customer_account_withdrawal()：auth.uid()本人からの退会申請だけを冪等・監査可能に受理する。成功は「申請受理」であって「退会完了」ではない。
- delete_unused_customer_account(p_customer_id uuid)：admin専用。Auth ID一致とcustomer roleを確かめる。関連参照（案件・見積・請求・契約・保存済み仕様・Snapshot・画像・Storage・通知・監査等）をDB側でロックして同一トランザクションで検査し、1件でも使用中/不明なら削除拒否。Auth削除の手段・ロール権限と実行順序は別途設計・レビュー。
- PUBLIC / anon / service_role には不要なEXECUTEを与えない。SECURITY DEFINERのsearch_pathを固定し、実効権限をテストする。
- RLSは直接Authユーザー削除の代わりにならない。ログイン無効化は新旧JWT・全セッション・本人の再登録まで確認が必要。

## 今回確定が必要（推測して実装しない）
1. 退会申請後、本人がいつログイン不可となるか（即時 / 担当確認後）。
2. 案件・見積・契約履歴がある退会会員のprofile個人情報をどう扱うか（保管根拠・期間・匿名化範囲）。
3. 退会を取り消せる期間、同一メールでの再登録、顧客番号再利用の有無。
4. 会員削除時の関連ファイル・Storage・通知・監査ログの保持範囲。

## 独立レビュー / 実DB検証
- FK ON DELETE CASCADE/SET NULL/RESTRICT、JSON・UUID配列・Auth連携の参照漏れ・不可逆削除を確認。
- 同時ログイン、見積作成/依頼、Auth削除、退会申請、担当者による削除を競合させて検証。
- 匿名/お客様/他人/代理店/総代理店/admin/service_role各権限の許可・拒否を実証。
- 先に本番main・PR・schema・migration history・pending・PITR・restoreをread-onlyで確認。
- 専用DB migration/RPCの独立レビュー後、本番は原則正式DB作業担当に依頼。
- mainマージと本番DB反映は別の完了状態。バックエンド未適用時は一切実行成功を返さない。
