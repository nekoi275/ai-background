import * as THREE from 'three'

export const WALL_COLOR = 0xf2e9e4
export const CEILING_COLOR = 0xc9ada7
export const FLOOR_COLOR = 0x9a8c98
export const TABLE_COLOR = 0x4a4e69

export interface RoomMaterials {
  materials: THREE.Material[]
}

export function createRoomMaterials(): RoomMaterials {
  function wall() {
    return new THREE.MeshStandardMaterial({
      color: WALL_COLOR,
      roughness: 0.9,
      side: THREE.BackSide,
      toneMapped: false,
    })
  }

  const ceiling = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    roughness: 0.95,
    side: THREE.BackSide,
    toneMapped: false,
  })
  const floor = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.85,
    side: THREE.BackSide,
    toneMapped: false,
  })
  return {
    materials: [wall(), wall(), ceiling, floor, wall(), wall()],
  }
}

export function createTableMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: TABLE_COLOR,
    roughness: 0.8,
    toneMapped: false,
  })
}

