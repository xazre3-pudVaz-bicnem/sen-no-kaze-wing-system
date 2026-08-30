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
let picker: ((face: ExteriorFaceCode) => void) | null = null;
const listeners = new Set<() => void>();

export function publishExteriorFaceDisplays(next: ExteriorFaceDisplay[]) {
  const nextSignature = JSON.stringify(next);
  if (nextSignature === signature) return;
  signature = nextSignature;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function publishExteriorFacePicker(next: ((face: ExteriorFaceCode) => void) | null) {
  picker = next;
}

/** 面別外壁選択を開く。登録前なら false を返し、呼び出し側で従来動作へフォールバックできる。 */
export function requestExteriorFacePicker(face: ExteriorFaceCode): boolean {
  if (!picker) return false;
  picker(face);
  return true;
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
