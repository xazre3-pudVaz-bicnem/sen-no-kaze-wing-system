import { describe, expect, it } from 'vitest';
import { isMissingFunction } from '@/lib/data/schema-compat';

describe('schema compatibility', () => {
  it('recognizes only missing RPC/function errors for compatibility fallback', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ message: 'Could not find the function public.example in the schema cache' })).toBe(true);
    expect(isMissingFunction({ message: 'schema cache refresh failed' })).toBe(false);
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingFunction({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
  });
});
