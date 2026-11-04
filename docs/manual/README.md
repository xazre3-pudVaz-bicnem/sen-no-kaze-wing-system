# システム操作マニュアル

マニュアルは **3 か所** にあります。内容は同じですが、用途が違います。

| 置き場所 | 用途 |
|---|---|
| 管理画面「操作マニュアル」（`/admin/manual`） | 実務中に引くもの。ログイン中の権限に応じて本部版／代理店版が出る |
| [hq.html](./hq.html) / [dealer.html](./dealer.html) | 印刷・PDF 化・オフライン配布用の単体 HTML |
| 公開 Artifact（下記 URL） | 社外・関係者への共有用 |

- 本部（管理者・総代理店）: https://claude.ai/code/artifact/8e378a62-c558-412d-b0d5-90226ffd648f
- 代理店・工務店: https://claude.ai/code/artifact/642f53ec-5170-4be0-b060-cc9f7710ed29

## 更新するとき

**管理画面版の本文は `lib/manual/content.ts` にあります。** 画面を変えたらまずここを直してください。
手順が画面と食い違ったままだと、マニュアルを信じた操作で事故が起きます。特に次は画面と直結しています。

- 管理メニューの並びと権限による出し分け（`components/admin/admin-nav.tsx`）
- 見積書の 5 区分（`components/simulator/quote-sheet.tsx` / `components/mypage/quote-table.tsx` / `lib/pdf/quote-pdf.tsx`）
- 別途工事の 9 項目（`lib/seed/catalog.ts` の `SITEWORK_CODES`）
- 権限の名称と範囲（`lib/domain/types.ts` の `ROLE_LABELS`）

配布用の HTML（hq.html / dealer.html）は手書きです。大きく変えたときは合わせて更新してください。
