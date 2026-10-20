import { describe, expect, it } from 'vitest';
import { isBlockedRemoteAddress } from '@/lib/http/remote-media';

describe('外部メディアURLの接続先制限', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('内部・特殊アドレス %s を拒否する', (address) => {
    expect(isBlockedRemoteAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
  ])('公開アドレス %s を許可候補として扱う', (address) => {
    expect(isBlockedRemoteAddress(address)).toBe(false);
  });
});
