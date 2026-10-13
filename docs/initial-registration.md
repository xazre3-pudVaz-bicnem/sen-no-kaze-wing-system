# 本体マスター・標準見積の初期登録

確定資料 `assets/source-docs/標準見積_初期登録候補整理_初期登録確認完了_20261008.xlsx` の 10 組み合わせを、本体マスター → 標準見積の順に登録します。登録の規則と単価の扱い（案 A）は `docs/assumptions.md` を参照してください。

確定資料と登録計画は原価を含むため、公開リポジトリには置きません（`assets/source-docs/`・`.wing-local/` は gitignore）。

## 1. 計画を作って確認する（DB へは書かない）

```sh
node scripts/initial-registration.ts
```

- 10 組み合わせそれぞれの本体・標準見積の行数と、DB が計算するはずの税抜・税込の合計を表示します
- 計画は `.wing-local/initial-registration-plan.json` に書き出します
- 組み合わせが 10 件でない、または問題がある場合は失敗します

## 2. 使い捨て DB で試す（リハーサル）

```sh
npm run db:rehearse -- --label reg --applied-through 20260829040000 --seed <本番時点のシード> --keep
# 本部の管理者（技術の杜の所属）を使い捨て DB に作り、その profile id を --actor に渡す
node scripts/initial-registration.ts --apply --db-url postgresql://supabase_admin:supabase_admin@127.0.0.1:54329/postgres --actor <profile id>
```

- 登録は RPC だけで行い、DB の検査（権限・identity・率・trunc）をすべて通します
- 登録後、DB が計算した金額が計画と一致することを確かめ、違えば失敗にします
- もう一度実行しても重複して登録しません（登録済みの組み合わせは金額だけ確認します）。途中で止まった場合は、残った下書きから続きを登録します。公開済みのものは上書きしません

## 3. 本番へ登録する（本番 migration の適用後、承認を得てから）

`.env.local` に本部の管理者アカウントを設定します（`WING_REGISTRATION_EMAIL` / `WING_REGISTRATION_PASSWORD`）。

```sh
node scripts/initial-registration.ts --apply --supabase --yes-production
```

## 4. 登録後の確認（統合版依頼書 §12）

```sh
npx supabase db query --linked --output-format json -f scripts/initial-registration/postflight.sql
```

読み取りだけで、件数と真偽だけを返します。`ok` がすべて `true` なら合格です。

| 観点 | 確認すること |
| --- | --- |
| 本体マスター | 10 件、組織 × 行 × 防火で一意、公開済み、構造・直接原価だけ（経費の行・経費の設定が無い）、Flat の防火は無い |
| 標準見積 | 10 件公開、公開中の本体 Revision を固定、本体の明細を写していない、率は初期値、原価・売価の合計がある、POR 無し、auto の売価が掛率と一致 |
| マトリクス | 有効な行 6・項目 15・セル 90、Flat 事務所は防火不可、hotel-single は無い |
