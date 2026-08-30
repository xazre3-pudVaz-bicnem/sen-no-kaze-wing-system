'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface SimulatorCaseImage {
  id: string;
  url: string;
  alt: string;
  caption: string | null;
}

const SimulatorCaseImagesContext = createContext<SimulatorCaseImage[]>([]);

export function SimulatorCaseImagesProvider({ images, children }: { images: SimulatorCaseImage[]; children: ReactNode }) {
  return <SimulatorCaseImagesContext.Provider value={images}>{children}</SimulatorCaseImagesContext.Provider>;
}

export function useSimulatorCaseImages(): SimulatorCaseImage[] {
  return useContext(SimulatorCaseImagesContext);
}
