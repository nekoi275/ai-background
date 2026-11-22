import type { ProductData } from './components/studio/index.ts'

export interface LoadedProduct {
  kind: 'photo' | 'model'
  name: string
  details: string
  data: ProductData | null
  size: { x: number; y: number; z: number } | null
  previewUrl: string | null
  sourcePng: Blob | null
  cutoutPng: Blob | null
  canUpgradeCutout: boolean
}
