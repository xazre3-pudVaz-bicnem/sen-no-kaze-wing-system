'use client';

import type { ExteriorFaceCode } from '@/lib/domain/exterior-wall';

export interface ExteriorFaceDisplay {
  face_code: ExteriorFaceCode;
  option_id: string;
  option_name: string;
  variant_names: string[];
  image_url: string | null;
}

const EMPTY: ExteriorFaceDisplay[] = [];
let snapshot: ExteriorFaceDisplay[] = EMPTY;
let signature = '';
const listeners = new Set<() => void>();

export function publishExteriorFaceDisplays(next: ExteriorFaceDisplay[]) {
  const nextSignature = JSON.stringify(next);
  if (nextSignature === signature) return;
  signature = nextSignature;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeExteriorFaceDisplays(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExteriorFaceDisplaysSnapshot() {
  return snapshot;
}

export function getExteriorFaceDisplaysServerSnapshot() {
  return EMPTY;
}
