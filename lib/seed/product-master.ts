/**
 * 先方の商品マスター（Wing_product_master_v1_5.xlsx）から自動生成。
 * 直接編集せず、`node scripts/generate-product-master.ts` を流し直すこと。
 *
 * 価格が未確定の商品・選択肢は price_on_request（別途見積）で登録している。
 * 金額が決まったらマスターを更新し、管理画面の「商品の一括登録」から取り込む。
 */
import type { OptionVariantChoice, OptionVariantGroup } from '../domain/types.ts';

export interface MasterProduct {
  id: string;
  code: string;
  categoryCode: string;
  name: string;
  description: string | null;
  manufacturer: string | null;
  model_no: string | null;
  size_note: string | null;
  list_price: number | null;
  highlight: string | null;
  price: number;
  price_on_request: boolean;
  image_url: string | null;
  sort_order: number;
}

export const masterProducts: MasterProduct[] = [
  {
    "id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "bath-ht-njb1216",
    "categoryCode": "ub",
    "name": "ハウステック NJB1216",
    "description": "コンパクトな1216サイズ。壁・水栓・照明などを選べます。",
    "manufacturer": "ハウステック",
    "model_no": "NJB1216",
    "size_note": "1216／室内1200×1600／最小設置1270×1670",
    "list_price": 584000,
    "highlight": "現行候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_main.jpg",
    "sort_order": 101
  },
  {
    "id": "2057e3d4-5e95-469c-89e9-2d7d55ecd124",
    "code": "toilet-pana-s160",
    "categoryCode": "toilet",
    "name": "Panasonic アラウーノ S160 タイプ1K",
    "description": "価格と機能のバランスを重視した標準候補です。",
    "manufacturer": "Panasonic",
    "model_no": "アラウーノ S160 タイプ1K",
    "size_note": "383×700×539mm",
    "list_price": 259000,
    "highlight": "標準候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/toilet_panasonic_alauno_s160_main.jpg",
    "sort_order": 102
  },
  {
    "id": "f7bd2962-d5ae-4cee-811c-75a557174f69",
    "code": "toilet-lixil-satiss",
    "categoryCode": "toilet",
    "name": "LIXIL サティスS S6相当",
    "description": "奥行650mmの省スペース性を重視した候補です。",
    "manufacturer": "LIXIL",
    "model_no": "サティスS S6相当",
    "size_note": "400×650×542mm",
    "list_price": 396000,
    "highlight": "おすすめ候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/toilet_lixil_satis_s_main.jpg",
    "sort_order": 103
  },
  {
    "id": "2b5fafad-2d3e-4b41-8ab6-c49635315afb",
    "code": "toilet-toto-rs1",
    "categoryCode": "toilet",
    "name": "TOTO ネオレストRS1",
    "description": "デザインと上位機能を重視した上位候補です。",
    "manufacturer": "TOTO",
    "model_no": "ネオレストRS1",
    "size_note": "386×691×515mm",
    "list_price": 327000,
    "highlight": "上位候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/toilet_toto_neorest_rs1_main.webp",
    "sort_order": 104
  },
  {
    "id": "6d392fcd-ccac-44b0-874c-6059934a4476",
    "code": "wash-pana-mline-w600",
    "categoryCode": "washbasin",
    "name": "Panasonic エムライン W600",
    "description": "シンプルで省スペース。基本機能を重視した標準候補です。",
    "manufacturer": "Panasonic",
    "model_no": "エムライン W600",
    "size_note": "間口600mm／奥行約420mm",
    "list_price": null,
    "highlight": "標準候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_panasonic_mline_w600_main.jpg",
    "sort_order": 105
  },
  {
    "id": "38f70ad4-cf3f-4e71-8fff-4bded8f4f984",
    "code": "wash-lixil-refra-w600",
    "categoryCode": "washbasin",
    "name": "LIXIL リフラ W600",
    "description": "奥行370mmの省スペース性を重視したおすすめ候補です。",
    "manufacturer": "LIXIL",
    "model_no": "リフラ W600",
    "size_note": "間口600mm／奥行370mm",
    "list_price": 110000,
    "highlight": "おすすめ候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_refra_w600_main.jpg",
    "sort_order": 106
  },
  {
    "id": "8578b720-eb16-4d44-83bf-aed4531bbf37",
    "code": "wash-lixil-esta-w600",
    "categoryCode": "washbasin",
    "name": "LIXIL エスタ ボウル一体タイプ W600",
    "description": "家具のようなデザインとコンパクトさを両立した上位候補です。",
    "manufacturer": "LIXIL",
    "model_no": "エスタ ボウル一体タイプ W600",
    "size_note": "間口600mm／奥行440mm",
    "list_price": 160000,
    "highlight": "上位候補",
    "price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_esta_w600_main.jpg",
    "sort_order": 107
  }
];

export const masterVariantGroups: Omit<OptionVariantGroup, 'note' | 'is_required' | 'status'>[] = [
  {
    "id": "5dc05328-65df-4cb4-808a-acb52dcce846",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "wall-plan",
    "name": "壁プラン",
    "sort_order": 1
  },
  {
    "id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "wall-color",
    "name": "壁色",
    "sort_order": 2
  },
  {
    "id": "d3334ad3-4add-4ba5-823e-65e3268037d8",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "shower-faucet",
    "name": "水栓・シャワー",
    "sort_order": 3
  },
  {
    "id": "03de2683-0d74-4024-81cf-5923401ab860",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "light",
    "name": "照明",
    "sort_order": 4
  },
  {
    "id": "4713c344-1ad3-435c-8de8-ae6174c80e92",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "mirror-storage",
    "name": "鏡・収納",
    "sort_order": 5
  },
  {
    "id": "8200723e-b8e4-4154-87a7-598ab01783b2",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "entrance",
    "name": "出入口",
    "sort_order": 6
  },
  {
    "id": "5ba23702-5f5f-4373-83cd-72edf9506dd5",
    "option_id": "6a947dcb-1ab7-4af5-8573-6ae0bbee642e",
    "code": "bath-insulation",
    "name": "浴槽断熱",
    "sort_order": 7
  },
  {
    "id": "faaf2987-a522-4ad2-8347-b774fd9cbea8",
    "option_id": "2057e3d4-5e95-469c-89e9-2d7d55ecd124",
    "code": "toilet-body",
    "name": "トイレ本体",
    "sort_order": 8
  },
  {
    "id": "5e7a8fea-5914-4459-8fbe-63808a315cfa",
    "option_id": "f7bd2962-d5ae-4cee-811c-75a557174f69",
    "code": "toilet-body",
    "name": "トイレ本体",
    "sort_order": 9
  },
  {
    "id": "0e6e75a7-e36b-49a7-8cc8-95cd36c740c4",
    "option_id": "2b5fafad-2d3e-4b41-8ab6-c49635315afb",
    "code": "toilet-body",
    "name": "トイレ本体",
    "sort_order": 10
  },
  {
    "id": "8fc2d0b2-dd82-4401-8d13-621ad16a11e6",
    "option_id": "6d392fcd-ccac-44b0-874c-6059934a4476",
    "code": "wash-body",
    "name": "洗面本体",
    "sort_order": 11
  },
  {
    "id": "1bad3d52-deb2-4ea0-8983-492fd971107d",
    "option_id": "38f70ad4-cf3f-4e71-8fff-4bded8f4f984",
    "code": "wash-body",
    "name": "洗面本体",
    "sort_order": 12
  },
  {
    "id": "66722ec1-7ff3-4e49-8484-d1883e212d8b",
    "option_id": "8578b720-eb16-4d44-83bf-aed4531bbf37",
    "code": "wash-body",
    "name": "洗面本体",
    "sort_order": 13
  },
  {
    "id": "ae62cdc5-04e8-4806-8e9a-1b7c23439993",
    "option_id": "6d392fcd-ccac-44b0-874c-6059934a4476",
    "code": "door-color",
    "name": "扉色",
    "sort_order": 14
  },
  {
    "id": "77c7ed44-8ef7-464d-8513-427aea28e34b",
    "option_id": "38f70ad4-cf3f-4e71-8fff-4bded8f4f984",
    "code": "door-color",
    "name": "扉色",
    "sort_order": 15
  },
  {
    "id": "52ca22bb-8ee3-4907-8794-2a924624a464",
    "option_id": "8578b720-eb16-4d44-83bf-aed4531bbf37",
    "code": "door-color",
    "name": "扉色",
    "sort_order": 16
  },
  {
    "id": "1921a799-d4be-4405-8f0d-5fc5bbec5a51",
    "option_id": "6d392fcd-ccac-44b0-874c-6059934a4476",
    "code": "mirror",
    "name": "ミラー",
    "sort_order": 17
  },
  {
    "id": "e6382bd9-e936-4766-8616-2871f408c7f5",
    "option_id": "38f70ad4-cf3f-4e71-8fff-4bded8f4f984",
    "code": "mirror",
    "name": "ミラー",
    "sort_order": 18
  },
  {
    "id": "9850745e-9779-46a2-8161-1c0c62365a98",
    "option_id": "8578b720-eb16-4d44-83bf-aed4531bbf37",
    "code": "mirror",
    "name": "ミラー",
    "sort_order": 19
  },
  {
    "id": "2cdd5c99-f5de-4f7f-8707-6e19ebfdccd9",
    "option_id": "6d392fcd-ccac-44b0-874c-6059934a4476",
    "code": "faucet",
    "name": "水栓",
    "sort_order": 20
  },
  {
    "id": "9abf6037-350e-421b-8ce6-2e8041746a91",
    "option_id": "38f70ad4-cf3f-4e71-8fff-4bded8f4f984",
    "code": "faucet",
    "name": "水栓",
    "sort_order": 21
  },
  {
    "id": "fe7379d3-0074-4892-8538-b86f47d3bb22",
    "option_id": "8578b720-eb16-4d44-83bf-aed4531bbf37",
    "code": "faucet",
    "name": "水栓",
    "sort_order": 22
  }
];

export const masterVariantChoices: Omit<OptionVariantChoice, 'status'>[] = [
  {
    "id": "3e99d1ca-fb49-47d2-8b7d-e3de847dd1e2",
    "group_id": "5dc05328-65df-4cb4-808a-acb52dcce846",
    "code": "full-white",
    "name": "全面ホワイト",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "da1f9b1e-2e10-4520-8589-93871428dadf",
    "group_id": "5dc05328-65df-4cb4-808a-acb52dcce846",
    "code": "accent",
    "name": "アクセント1面",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "5f045d06-6b3e-4cd1-87cb-8a0075e929fd",
    "group_id": "5dc05328-65df-4cb4-808a-acb52dcce846",
    "code": "accent-2",
    "name": "アクセント2面",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 3
  },
  {
    "id": "f02e066f-51e1-40d3-8307-596dae2539e4",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "emboss-beige",
    "name": "エンボスベージュ",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_emboss_beige.jpg",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 1
  },
  {
    "id": "6e64dac1-3b60-48c3-81e4-150076bd6bac",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "queen-beige",
    "name": "クイーンベージュ",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_queen_beige.jpg",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 2
  },
  {
    "id": "36ee8e39-7109-4c1a-89ae-021804e3e857",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "oak-greige",
    "name": "オークグレージュ",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_oak_greige.jpg",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 3
  },
  {
    "id": "713e5f7d-5be8-4d91-861f-53944245d9da",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "walnut-light",
    "name": "ウォールナットライト",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_walnut_light.jpg",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 4
  },
  {
    "id": "83f5f6f2-a50d-45d6-80e4-dac379fa13a8",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "walnut-dark",
    "name": "ウォールナットダーク",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_walnut_dark.jpg",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 5
  },
  {
    "id": "f2358642-bf54-4ea5-819e-557b20225ec9",
    "group_id": "7d1111ac-8c1c-4c4b-8b6b-5bda1135581e",
    "code": "lunaak-gray",
    "name": "ルナークグレー",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_wall_lunaak_gray.png",
    "note": "壁プランで「アクセント1面」または「アクセント2面」を選択した場合に表示",
    "sort_order": 6
  },
  {
    "id": "e598d2d8-8f40-4a24-8b27-e0ac652d982e",
    "group_id": "d3334ad3-4add-4ba5-823e-65e3268037d8",
    "code": "shower-faucet-standard",
    "name": "標準デッキ2ハンドル水栓＋標準スプレーシャワー",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "4c9f85c5-fd50-4a8f-8ddf-167d9a9400f1",
    "group_id": "d3334ad3-4add-4ba5-823e-65e3268037d8",
    "code": "e-nf",
    "name": "壁付サーモ水栓＋eシャワーNf",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_shower_e_nf.jpg",
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "a176aa1d-e9ee-47be-8306-a05397845d0e",
    "group_id": "03de2683-0d74-4024-81cf-5923401ab860",
    "code": "led-1",
    "name": "モチ形LED 1灯",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": "/images/catalog/bath_housetec_njb1216_light_mochi_led.jpg",
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "1d810868-268d-4c28-819a-f5256724e73b",
    "group_id": "03de2683-0d74-4024-81cf-5923401ab860",
    "code": "led",
    "name": "クリアキューブLED",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_light_clear_cube_led.jpg",
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "20faa1ac-8a08-4f0e-81b1-c891c93e39e1",
    "group_id": "4713c344-1ad3-435c-8de8-ae6174c80e92",
    "code": "none",
    "name": "なし",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "9acbe8e1-0216-4ef8-8637-41070679f271",
    "group_id": "4713c344-1ad3-435c-8de8-ae6174c80e92",
    "code": "mr-250x900",
    "name": "縦長ミラー MR-250X900",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "ba1bc835-573c-4d80-8c51-944b8d038638",
    "group_id": "4713c344-1ad3-435c-8de8-ae6174c80e92",
    "code": "t-cnm-x2",
    "name": "縦長ミラー＋コーナー棚 T-CNM-X2",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 3
  },
  {
    "id": "dc62b95e-c56b-47fe-864a-f19d6dec8844",
    "group_id": "8200723e-b8e4-4154-87a7-598ab01783b2",
    "code": "standard",
    "name": "標準",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "4ed9f4fc-b603-4d0a-8c00-d9bef7e77cde",
    "group_id": "8200723e-b8e4-4154-87a7-598ab01783b2",
    "code": "low-floor-spec",
    "name": "低床仕様",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_option_low_floor.jpg",
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "e37c496c-35c9-4ab3-8a20-6a44985aa949",
    "group_id": "5ba23702-5f5f-4373-83cd-72edf9506dd5",
    "code": "standard",
    "name": "標準浴槽",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "常時表示",
    "sort_order": 1
  },
  {
    "id": "a3876753-7262-49d2-8c4a-ae2619ec8927",
    "group_id": "5ba23702-5f5f-4373-83cd-72edf9506dd5",
    "code": "insulation",
    "name": "高断熱浴槽パック",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/bath_housetec_njb1216_option_high_insulation.jpg",
    "note": "常時表示",
    "sort_order": 2
  },
  {
    "id": "42fab0bd-09d4-4387-897d-c80595f718f8",
    "group_id": "faaf2987-a522-4ad2-8347-b774fd9cbea8",
    "code": "panasonic-s160",
    "name": "Panasonic アラウーノ S160",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": "/images/catalog/toilet_panasonic_alauno_s160_main.jpg",
    "note": "トイレカテゴリー選択時に表示",
    "sort_order": 1
  },
  {
    "id": "fbbf0135-b541-4454-8843-059429ccce6b",
    "group_id": "5e7a8fea-5914-4459-8fbe-63808a315cfa",
    "code": "lixil-s",
    "name": "LIXIL サティスS",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/toilet_lixil_satis_s_main.jpg",
    "note": "トイレカテゴリー選択時に表示",
    "sort_order": 2
  },
  {
    "id": "35ac7338-8334-4118-80fd-ba6323aac4b3",
    "group_id": "0e6e75a7-e36b-49a7-8cc8-95cd36c740c4",
    "code": "toto-rs1",
    "name": "TOTO ネオレストRS1",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/toilet_toto_neorest_rs1_main.webp",
    "note": "トイレカテゴリー選択時に表示",
    "sort_order": 3
  },
  {
    "id": "9fe40a5b-7b17-4a13-824d-be019299202a",
    "group_id": "8fc2d0b2-dd82-4401-8d13-621ad16a11e6",
    "code": "panasonic-w600",
    "name": "Panasonic エムライン W600",
    "kind": "standard",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": "/images/catalog/wash_panasonic_mline_w600_main.jpg",
    "note": "洗面カテゴリー選択時に表示",
    "sort_order": 1
  },
  {
    "id": "39c39a6f-e1d7-455c-82d7-7a68631f6df0",
    "group_id": "1bad3d52-deb2-4ea0-8983-492fd971107d",
    "code": "lixil-w600",
    "name": "LIXIL リフラ W600",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_refra_w600_main.jpg",
    "note": "洗面カテゴリー選択時に表示",
    "sort_order": 2
  },
  {
    "id": "a0a03c6b-dbf3-4f3c-8568-a79381b3e5a3",
    "group_id": "66722ec1-7ff3-4e49-8484-d1883e212d8b",
    "code": "lixil-w600",
    "name": "LIXIL エスタ ボウル一体タイプ W600",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_esta_w600_main.jpg",
    "note": "洗面カテゴリー選択時に表示",
    "sort_order": 3
  },
  {
    "id": "7118b66f-f26e-4bc2-8f5e-0c47d61da543",
    "group_id": "ae62cdc5-04e8-4806-8e9a-1b7c23439993",
    "code": "white",
    "name": "ホワイト",
    "kind": "fixed",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "エムライン選択時に固定表示",
    "sort_order": 1
  },
  {
    "id": "e05c1f6d-d463-4aa7-8adf-8f8148b13366",
    "group_id": "77c7ed44-8ef7-464d-8513-427aea28e34b",
    "code": "white",
    "name": "ホワイト",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_refra_w600_color_white.jpg",
    "note": "リフラ選択時に表示",
    "sort_order": 1
  },
  {
    "id": "5daa8c79-955a-4076-8df0-45fef5157eca",
    "group_id": "77c7ed44-8ef7-464d-8513-427aea28e34b",
    "code": "crie-pale",
    "name": "クリエペール",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_refra_w600_color_crie_pale.jpg",
    "note": "リフラ選択時に表示",
    "sort_order": 2
  },
  {
    "id": "103a0ede-3b97-4cd7-86c0-fea2f8b657fd",
    "group_id": "77c7ed44-8ef7-464d-8513-427aea28e34b",
    "code": "crie-dark",
    "name": "クリエダーク",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_refra_w600_color_crie_dark.jpg",
    "note": "リフラ選択時に表示",
    "sort_order": 3
  },
  {
    "id": "2d7c051c-e09b-4cea-8d53-c6680f9f8c26",
    "group_id": "52ca22bb-8ee3-4907-8794-2a924624a464",
    "code": "white",
    "name": "ホワイト",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_esta_w600_color_white.jpg",
    "note": "エスタ選択時に表示",
    "sort_order": 1
  },
  {
    "id": "f90c500f-6075-4cc3-8bf7-b9d56a7dc88e",
    "group_id": "52ca22bb-8ee3-4907-8794-2a924624a464",
    "code": "crie-pale",
    "name": "クリエペール",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_esta_w600_color_crie_pale.jpg",
    "note": "エスタ選択時に表示",
    "sort_order": 2
  },
  {
    "id": "9fdd2d56-2b83-46ac-8022-02c3921923ff",
    "group_id": "52ca22bb-8ee3-4907-8794-2a924624a464",
    "code": "crie-dark",
    "name": "クリエダーク",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": "/images/catalog/wash_lixil_esta_w600_color_crie_dark.jpg",
    "note": "エスタ選択時に表示",
    "sort_order": 3
  },
  {
    "id": "231822f1-7b45-40c8-89b8-73d675c91dd7",
    "group_id": "1921a799-d4be-4405-8f0d-5fc5bbec5a51",
    "code": "mirror",
    "name": "1面鏡",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "エムライン選択時に表示",
    "sort_order": 1
  },
  {
    "id": "e619fff2-5153-4c51-8798-1cafa64e516e",
    "group_id": "1921a799-d4be-4405-8f0d-5fc5bbec5a51",
    "code": "mirror-storage",
    "name": "3面鏡（収納付）",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "エムライン選択時に表示",
    "sort_order": 2
  },
  {
    "id": "6eebbaf1-2298-4815-8cf5-e622f1919209",
    "group_id": "e6382bd9-e936-4766-8616-2871f408c7f5",
    "code": "mirror",
    "name": "1面鏡",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "リフラ選択時に表示",
    "sort_order": 1
  },
  {
    "id": "aa3b65da-e258-4e83-8625-7583890bfc21",
    "group_id": "e6382bd9-e936-4766-8616-2871f408c7f5",
    "code": "mirror-storage",
    "name": "収納付ミラー",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "リフラ選択時に表示",
    "sort_order": 2
  },
  {
    "id": "acc1a993-914f-4b52-8f3e-d973732680be",
    "group_id": "9850745e-9779-46a2-8161-1c0c62365a98",
    "code": "mirror",
    "name": "1面鏡",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "エスタ選択時に表示",
    "sort_order": 1
  },
  {
    "id": "bb7d7b9d-62c4-4357-8b1f-6f62d8dd3b58",
    "group_id": "9850745e-9779-46a2-8161-1c0c62365a98",
    "code": "mirror-storage",
    "name": "収納付ミラー",
    "kind": "option",
    "extra_price": 0,
    "price_on_request": true,
    "image_url": null,
    "note": "エスタ選択時に表示",
    "sort_order": 2
  },
  {
    "id": "f3d02efb-9110-4a0a-8478-6effe61708de",
    "group_id": "2cdd5c99-f5de-4f7f-8707-6e19ebfdccd9",
    "code": "shower",
    "name": "シングルレバーシャワー",
    "kind": "fixed",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "エムライン選択時に固定",
    "sort_order": 1
  },
  {
    "id": "fd9b5afe-fd3f-46cb-8a3d-9a0aa80fcef6",
    "group_id": "9abf6037-350e-421b-8ce6-2e8041746a91",
    "code": "standard-fixed-spec",
    "name": "標準仕様で固定",
    "kind": "fixed",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "リフラ選択時に固定",
    "sort_order": 1
  },
  {
    "id": "8cbde7d5-0189-4410-8186-540c045c1d58",
    "group_id": "fe7379d3-0074-4892-8538-b86f47d3bb22",
    "code": "standard-fixed-spec",
    "name": "標準仕様で固定",
    "kind": "fixed",
    "extra_price": 0,
    "price_on_request": false,
    "image_url": null,
    "note": "エスタ選択時に固定",
    "sort_order": 1
  }
];
