# システム操作マニュアル

| 対象 | ファイル | 公開URL（社内共有用） |
|---|---|---|
| 本部（管理者・総代理店） | [hq.html](./hq.html) | https://claude.ai/code/artifact/8e378a62-c558-412d-b0d5-90226ffd648f |
| 代理店・工務店 | [dealer.html](./dealer.html) | https://claude.ai/code/artifact/642f53ec-5170-4be0-b060-cc9f7710ed29 |

HTML 単体で完結しているので、ブラウザで開けばそのまま読めます。印刷・PDF 化も可能です。

画面を変更したときは、対応する章を更新してください。手順が画面と食い違ったままだと、
マニュアルを信じた操作で事故が起きます。特に次の箇所は画面と直結しています。

- 管理メニューの並びと権限による出し分け（`components/admin/admin-nav.tsx`）
- 見積書の 5 区分（`components/simulator/quote-sheet.tsx` / `components/mypage/quote-table.tsx` / `lib/pdf/quote-pdf.tsx`）
- 別途工事の 9 項目（`lib/seed/catalog.ts` の `SITEWORK_CODES`）
- 権限の名称と範囲（`lib/domain/types.ts` の `ROLE_LABELS`）
