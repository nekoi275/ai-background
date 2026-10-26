import * as THREE from 'three'

export interface RoomConfig {
  width: number
  height: number
  depth: number
}

export type TableShape = 'box' | 'cylinder'

export interface TableConfig {
  visible: boolean
  shape: TableShape
  width: number
  depth: number
  height: number
  x: number
  z: number
}

export type ProductData =
  | { kind: 'photo'; url: string; aspect: number }
  | { kind: 'model'; object: THREE.Object3D }

export interface StudioScene {
  setRoom(room: RoomConfig): void
  setTable(table: TableConfig): void
  setProduct(product: ProductData | null): void
  setPhotoHeight(fraction: number): void
  setGlossy(glossy: boolean): void
  captureSize(): { width: number; height: number }
  captureView(): string
  captureDepth(): string
  capturePlate(): string
  captureReflection(): string | null
  captureShadow(): string | null
}
