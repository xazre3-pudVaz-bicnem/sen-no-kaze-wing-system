import { describe, expect, it } from 'vitest';
import { parseConfigurationOptionFilter } from '@/lib/domain/configuration-option-filter';

const id = '69a71c24-7a68-482b-94f7-37508a95d69b';

describe('保存プラン絞り込みの option_id パラメータ', () => {
  it('未指定の場合だけ全件表示モードを許可する', () => {
    expect(parseConfigurationOptionFilter(undefined)).toEqual({ hasFilter: false, optionId: null });
  });

  it('正常なUUID指定では商品フィルタを有効にする', () => {
    expect(parseConfigurationOptionFilter(id)).toEqual({ hasFilter: true, optionId: id });
    expect(parseConfigurationOptionFilter(' ' + id.toUpperCase() + ' ')).toEqual({ hasFilter: true, optionId: id.toUpperCase() });
  });

  it('空・不正・重複指定は必ず絞り込み0件モードにする', () => {
    for (const value of ['', 'not-a-uuid', [], [id], [id, id], [id, 'bad'], null, 42]) {
      expect(parseConfigurationOptionFilter(value)).toEqual({ hasFilter: true, optionId: null });
    }
  });
});
