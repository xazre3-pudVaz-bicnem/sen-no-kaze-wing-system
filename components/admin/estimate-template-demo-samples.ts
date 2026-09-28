import { BoxHotelSingleSample } from './estimate-template-demo-sample-box-hotel-single';
import { FlatOfficeSample } from './estimate-template-demo-sample-flat-office';
import { WingHotelSample } from './estimate-template-demo-sample-wing-hotel';
import { WingOfficeSample } from './estimate-template-demo-sample-wing-office';
import { WingSingleSample } from './estimate-template-demo-sample-wing-single';
import type { EstimateDemoSample } from './estimate-template-demo-sample-types';

export const ESTIMATE_DEMO_SAMPLES: EstimateDemoSample[] = [
  WingHotelSample,
  WingSingleSample,
  WingOfficeSample,
  BoxHotelSingleSample,
  FlatOfficeSample,
];

export function estimateDemoSampleById(id?: string | null) {
  if (!id) return null;
  return ESTIMATE_DEMO_SAMPLES.find((sample) => sample.id === id) ?? null;
}

export type { EstimateDemoSample, EstimateDemoSampleRow } from './estimate-template-demo-sample-types';
