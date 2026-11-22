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

export type ProductData = { kind: 'model'; object: THREE.Object3D }

export type Placement = 'floor' | 'wall' | 'ceiling' | 'cover'

export type MountWall = 'back' | 'left' | 'right' | 'front'

export interface MountConfig {
  wall: MountWall
  height: number
  offset: number
  offsetZ: number
  yaw: number
}

export interface CoverConfig {
  walls: boolean
  floor: boolean
  ceiling: boolean
}

export interface StudioScene {
  setRoom(room: RoomConfig): void
  setTable(table: TableConfig): void
  setProduct(product: ProductData | null): void
  setPlacement(placement: Placement): void
  setMount(config: MountConfig): void
  setCover(config: CoverConfig): void
  setScale(scale: number): void
  captureSize(): { width: number; height: number }
  captureView(): string
  captureProductReference(): string
}
