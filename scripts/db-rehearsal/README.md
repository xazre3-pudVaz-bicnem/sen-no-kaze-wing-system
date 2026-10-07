# DB リハーサル

マイグレーションを**実際の PostgreSQL へ適用して**確かめるための道具です。
`tests/` の SQL 文字列検査では、構文エラー・未解決の関数参照・実効権限の漏れは見つかりません。
本番（Supabase）へ適用する前に、ここで必ず通してください。

## CI（推奨）

`.github/workflows/db-rehearsal.yml` が、`supabase/**`・`lib/data/**`・`lib/actions/**` を変更した PR で動きます。

1. `supabase db start` … 本物の Supabase ローカル DB へ全マイグレーションを古い順に適用
2. `supabase db lint` … plpgsql_check で関数本体をスキーマと照合
3. `npm run db:check` … 下記の検査

## ローカル（docker 不要）

```bash
npm i --no-save embedded-postgres@17.6.0-beta.15   # 初回だけ
npm run db:rehearse
```

PostgreSQL 17 を一時起動し、`bootstrap.sql` で本番 Supabase と同じロール・既定権限・`auth`／`storage` の前提を作ってから、
`supabase/migrations` を `postgres` ロールで 1 本ずつ適用します。結果は `.wing-local/db-rehearsal/<label>/` に出ます。

| オプション | 用途 |
| --- | --- |
| `--applied-through <version>` | ここまでを「本番適用済み」、以降を「未適用」として区切る |
| `--prod-catalog <json>` | 区切りの時点で本番カタログ（`catalog.sql` の実行結果）と差分比較する |
| `--seed <json>` | 区切りの時点でマスターデータを投入する（`{ "tables": { "<table>": [rows] } }`） |
| `--extra <dir>` | 別ブランチのマイグレーションを足して試す |
| `--baseline-only` | 区切りまでで止める（現在の本番相当のスキーマを作る） |
| `--keep` | 検査後も起動したままにする（`127.0.0.1:54329`） |

本番カタログの取得（読み取りのみ・データは含まない）:

```bash
npx supabase db query --linked --output-format json -f scripts/db-rehearsal/catalog.sql
```

## 検査内容（`checks.mjs`）

1. `public` の全テーブルで RLS が有効
2. 未ログイン（`anon`）が実行できる `SECURITY DEFINER` 関数は許可リストの範囲だけ
3. `SECURITY DEFINER` 関数は `search_path` を固定している
4. アプリの Supabase 呼び出し（RPC 名と引数名・テーブル・列）が DB と一致している

### EXECUTE 権限の注意

Supabase は、`postgres` が `public` に作った関数へ `anon`／`authenticated`／`service_role` の EXECUTE を既定で付与します。
`revoke ... from public` だけではこの付与は外れません。

```sql
revoke execute on function public.some_rpc(uuid) from public, anon, authenticated, service_role;
grant execute on function public.some_rpc(uuid) to authenticated;
```

### 拡張機能の関数

`pgcrypto` などは `extensions` スキーマにあります。`set search_path = public` の関数からは
`extensions.digest(...)` のようにスキーマ修飾して呼びます。

## 限界

- ローカルの `bootstrap.sql` は Supabase の再現であり、本物ではありません（CI は本物のイメージを使います）
- 本番データは使いません。データ依存の分岐は、シードまたは本番の事前確認で別途確かめます
