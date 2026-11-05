# 独自ドメイン（www.sen-no-kaze.com）への内部設定の統一

サイトはすでに `https://www.sen-no-kaze.com` で運用しています（`sen-no-kaze.com` は www へ 308 で転送）。
新しいドメインへの切り替えではなく、まだ Vercel の既定のドメイン（`https://sen-no-kaze-wing-system.vercel.app`）を指している内部の設定を www へそろえる作業です（2026-10-29 先方の回答）。

## どこから URL を作っているか（コード）

canonical・OGP・sitemap・robots の Sitemap 行・通知メールのリンク・会員登録とパスワード再設定のメールの戻り先は、すべて環境変数 `NEXT_PUBLIC_SITE_URL`（`lib/site.ts` の `getSiteUrl()`）から作ります。コードに vercel.app を書いている箇所はありません。

| 用途 | 作り方 |
| --- | --- |
| canonical・OGP・JSON-LD | `lib/seo.ts`・`app/layout.tsx`（metadataBase） |
| sitemap・robots | `app/sitemap.ts`・`app/robots.ts` |
| 通知メールのリンク | `lib/mail/send.ts` |
| 会員登録の確認・パスワード再設定の戻り先 | `lib/actions/auth.ts`（`NEXT_PUBLIC_SITE_URL` があればそのオリジン、無ければ今のリクエストのオリジン） |
| パスワード再設定の画面 | `app/(site)/reset-password/page.tsx`（申し込みを戻り先と同じホストで行わせる。Cookie はホストごとのため） |
| 電子契約（GMOサイン）の通知先 | `scripts/gmosign-register-webhook.ts`（既定で www） |

`NEXT_PUBLIC_SITE_URL` を www にすれば、上の出力はすべて www になります。`NEXT_PUBLIC_` の値はビルド時に埋め込まれるため、変更の後に再デプロイが要ります。

## 本番の設定（変更は内容の確認の後に行う）

| 設定 | 今の値（確かめた方法） | 変更の内容 |
| --- | --- | --- |
| Vercel の環境変数 `NEXT_PUBLIC_SITE_URL`（Production） | `https://sen-no-kaze-wing-system.vercel.app`（本番の HTML の canonical・OGP・sitemap がこの値。2026-10-26 に確認） | `https://www.sen-no-kaze.com` に変えて再デプロイ |
| Supabase Auth の Site URL | `https://sen-no-kaze-wing-system.vercel.app`（`supabase/config.toml` の記録。ダッシュボードの実際の値はこの環境から読めない） | `https://www.sen-no-kaze.com` |
| Supabase Auth の Redirect URLs | vercel.app の `/auth/callback` と `/**`、localhost（同上） | www の `/auth/callback` と `/**` を足す。切り替え前に送ったメールのリンクのため、vercel.app はしばらく残す |
| Supabase Auth の SMTP | ダッシュボードの値はこの環境から読めない | 独自の SMTP が未設定なら設定する（下記） |
| アプリの通知メール（Resend：`RESEND_API_KEY`・`MAIL_FROM`） | Vercel の値はこの環境から読めない | 差出人をドメイン認証済みの `@sen-no-kaze.com`（または会社のドメイン）にそろえる |

### SMTP について

- Supabase の既定のメール送信は、プロジェクトのメンバーのアドレスにしか届かず、送信数の上限も小さいため、お客様のパスワード再設定・確認メールの本番運用には使えません。独自の SMTP（例：アプリの通知と同じ Resend の SMTP）を設定してください
- 差出人のドメインに SPF・DKIM（送信サービスの指定の DNS レコード）を設定してください。未設定だと迷惑メールに入りやすくなります
- 今の設定では会員登録の確認メールを待たずにログインできます（`enable_confirmations = false`）。確認メールを必須にするかは別の判断です（今回は変えません）

## リポジトリで変えたもの

- `supabase/config.toml`：Site URL を www、Redirect URLs に www を追加（vercel.app・localhost は残す）。この値は `supabase config push` を実行したときだけ本番へ反映される（実行は本番の設定変更として別途）
- `README.md`・`.env.example`：本番の URL を www に
