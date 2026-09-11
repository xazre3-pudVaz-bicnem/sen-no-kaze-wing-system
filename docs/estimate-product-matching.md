# 標準見積Excelと商品マスター照合

## 目的

標準見積Excelを「標準見積金額の正本」、商品マスターを「商品識別・選択・発注・変更差額の正本」として分離しつつ、同じ商品IDでシミュレーターから見積・発注までつなぐ。

## 正式ルール

1. Excel取込は現在有効な標準見積を即時変更しない。
2. 1シートの取込を1バージョンとして保存する。
3. Excel原文・行番号・金額を取込明細として保持する。
4. 明細は安定した `line_fingerprint` を持ち、行番号がずれても照合知識を再利用できるようにする。
5. 今回の照合結果（estimate_product_links）と、次回へ再利用する照合ルール（product_match_rules）は分離する。
6. 紐付け区分は `required / optional / none` の3段階とする。
7. 自動一致はメーカー＋型番の一意な完全一致など、高信頼条件だけで確定する。
8. 必須商品が1件でも未照合なら有効化不可とする。
9. 有効化時、確認済み商品を `baseline_option_ids` に反映する。同カテゴリの旧baselineは置換し、それ以外の既存baselineは互換性のため維持する。
10. 有効化時だけ既存 `estimate_templates` を更新し、現在のシミュレーター計算経路をそのまま使う。
11. 価格は「Excel標準額 ＋（変更商品マスター価格 − 標準商品マスター価格）」とする。
12. 発行済み見積は既存の `quote_items` スナップショットを継続する。

## DB

### estimate_imports

Excel取込のバージョン。モデル・仕様ごとに version を採番する。

主な項目:
- base_model_id
- spec_code
- version
- source_file_name / source_sheet_name / source_sha256
- status: review / ready / activated / superseded
- Excelの集計金額
- template_payload（既存標準見積RPCへ渡す検算済みデータ）
- imported_at / activated_at

### estimate_import_lines

Excel原文の明細。

主な項目:
- import_id
- section_code
- source_row
- original_name / normalized_name
- category_id
- manufacturer_text / model_text / size_text
- quantity / unit / unit_price / amount / remark
- link_policy
- line_fingerprint / fingerprint_ordinal

### estimate_product_links

今回の取込で確定した商品リンク。

主な項目:
- import_line_id
- option_id
- match_type: automatic / manual / saved_rule
- match_reason
- confidence
- confirmed_at / confirmed_by

### product_match_rules

次回以降に再利用する、人が確認済みの照合知識。

主な項目:
- scope: spec / model / global
- base_model_id / spec_code
- category_id
- match_key
- option_id

## 管理画面フロー

```
標準見積Excelを選択
  ↓
4分類・金額を検算
  ↓
商品照合の事前判定
  ↓
「商品照合用に取り込む」
  ↓
取込バージョンを保存（まだ本番には反映しない）
  ↓
商品照合画面
  ├─ 自動一致
  ├─ 前回照合を再利用
  ├─ 候補あり
  ├─ 未照合
  └─ 紐付け不要
  ↓
要確認行だけ、人が商品マスターから選択
  ↓
必須未照合 = 0
  ↓
「この見積を有効にする」
  ↓
既存 estimate_templates / baseline_option_ids を更新
  ↓
シミュレーターへ反映
```

## 商品選択

「商品を選択」では、判定されたカテゴリの商品だけを優先表示する。

例: ユニットバスの明細なら、浴室（ユニットバス）の商品を表示し、メーカー・型番・サイズ・画像・価格を見ながら選択する。

カテゴリ誤判定時は、同じ画面でカテゴリと `required / optional / none` を変更できる。

商品マスターに存在しない場合は「新しい商品を登録」を別タブで開き、登録後に照合画面へ戻って選択する。

## 再取込

新しいExcelは既存有効版を上書きせず、新しい version として作成する。

照合ルールは取込バージョンとは別テーブルに保持するため、Excel明細を再作成しても、同じ fingerprint・適用範囲の確認済みルールを再利用できる。

行番号は監査・表示用であり、照合キーには使用しない。

## 段階実装

現段階では次を行わない。

- AIによる商品自動判定
- 高度な曖昧検索
- 代理店別の照合辞書
- 商品マスター完全版管理
- 期間別価格履歴
- 後継商品の自動置換
- 自動商品登録

まずは「型番中心の決定論的照合 + 候補表示 + 人の確認 + 照合知識の再利用」で運用する。
