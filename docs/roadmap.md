# ロードマップ（第二・第三段階へ回す範囲）

## 第一段階（今回実装）

- 商品紹介（トップ・一覧・詳細）、2D 画像式見積シミュレーター、会員登録／ログイン／再設定
- マイページ（保存・再編集・複製・削除・見積依頼・見積書 PDF）
- 管理画面（モデル・カテゴリー・オプション・ルール・プレビュー画像・顧客・仕様・見積）
- サーバー側の価格再計算・採番・スナップショット、RLS、SEO／構造化データ

## 第二段階（候補・先方 LINE の要望を含む）

| 機能 | 追加するもの | 既存構造との接続 |
|---|---|---|
| **代理店ID による別途工事入力** | 代理店アカウント（`roles` に `partner`）、担当顧客、別途工事 9 項目の金額入力、代理店名義の見積書出力。見積書印刷に ID を必須化 | `quotes.dealer_id`・`quote_items.kind='installation'` は確保済み。`partners` テーブルと RLS（partner は担当顧客のみ）を追加 |
| **書類の ID 管理** | 見積書・注文書・契約書を顧客番号／見積番号／代理店IDで紐付けて保管・検索 | `profiles.customer_no` は採番済み。`documents(kind, quote_id, customer_no, dealer_id, storage_path)` を追加 |
| 通知メール | Resend / SES で見積依頼・問い合わせ・ステータス変更を通知 | `lib/actions/contact.ts`、`requestQuoteAction` 後に送信。`QUOTE_NOTIFY_EMAIL` |
| 正式見積の差し替え | 管理者が正式見積（PDF アップロード or 明細編集）を追加発行 | `quotes` に `parent_quote_id`・`kind ('estimate'|'formal')` を追加。番号は `next_quote_no()` を再利用 |
| 電子契約 | クラウドサイン等との連携、契約ステータス | 新テーブル `contracts(quote_id, provider, provider_ref, status, signed_at)`。`configurations.status` に `contracted` を追加 |
| 図面承認 | 設置図・確認申請図の提出と顧客承認 | 新テーブル `drawing_approvals(configuration_id, file_path, version, status, approved_at)`。Storage バケット `drawings`（非公開） |
| 複数ベースモデル | Wing 02（2台結合）など | `base_models` 追加と `options.base_model_id` の絞り込みだけで対応可能（実装済み） |
| 数量付きオプション | 窓 ×2 など | `configuration_items.quantity` は保持済み。UI に数量入力を追加し `computePricing` はそのまま |

## 第三段階（候補）

| 機能 | 追加するもの | 既存構造との接続 |
|---|---|---|
| 販売パートナー管理 | 代理店アカウント・担当顧客・紹介コード | 新テーブル `partners`、`roles` に `partner` を追加、`configurations.partner_id`（列は確保済み）、RLS に partner ポリシー追加 |
| 販売手数料の自動計算 | 契約金額 × 料率 | `partners.commission_rate`、`commissions(contract_id, amount)` |
| 決済 | 手付金のオンライン決済（Stripe） | `payments(quote_id, provider_ref, amount, status)`。Webhook ルート追加 |
| 在庫・製造・配送管理 | 製造ロット、配送予定 | `production_orders`、`deliveries` |
| 3D / AR | 将来的に Three.js で置き換える場合も `preview_image_rules` の「選択キー → 表示」インターフェースは流用可能 | `PreviewStage` を差し替え |

## 設計上の拡張ポイント（コード）

- `lib/data/store.ts` の `DataStore` インターフェースに処理を追加し、`SupabaseStore` / `LocalStore` 両方に実装する
- ステータス遷移は `configurations.status` / `quote_requests.status` / `quotes.status` の 3 軸。新ステータスは `lib/domain/types.ts` の enum と SQL の check 制約を同時に更新する
- 見積金額はスナップショットのため、正式見積は**新しい quote 行として追加**し、上書きしない
