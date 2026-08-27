import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ uploadImage: vi.fn(), deleteUploadedImage: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: async () => ({ id: 'admin', email: 'admin@example.com', full_name: '管理者', role: 'admin' }),
}));
vi.mock('@/lib/data/store', () => ({
  isLocalMode: () => true,
  getStore: async () => mocks,
}));

import { POST } from '@/app/api/admin/catalog-import/images/route';

const MB = 1024 * 1024;

function uploadRequest(size: number) {
  const formData = new FormData();
  formData.set('file', new File([new Uint8Array(size)], 'large.jpg', { type: 'image/jpeg' }));
  return new Request('http://localhost/api/admin/catalog-import/images', { method: 'POST', body: formData });
}

describe('ローカル商品画像 Route Handler', () => {
  beforeEach(() => {
    mocks.uploadImage.mockReset().mockResolvedValue('/api/local-files/catalog-import/test.jpg');
  });

  it.each([
    ['4MB付近', 4 * MB - 1024],
    ['4MB超', 4 * MB + 1024],
  ])('%sの画像をServer Action上限に影響されず保存する', async (_label, size) => {
    const response = await POST(uploadRequest(size) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: '/api/local-files/catalog-import/test.jpg' });
    expect(mocks.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      bytes: expect.objectContaining({ byteLength: size }),
      contentType: 'image/jpeg',
      fileName: 'large.jpg',
    }), 'catalog-import');
  });

  it('10MB超の画像を拒否する', async () => {
    const response = await POST(uploadRequest(10 * MB + 1) as never);
    expect(response.status).toBe(400);
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });
});
