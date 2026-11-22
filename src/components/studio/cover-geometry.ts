import * as THREE from 'three'
import type { CoverConfig, MountWall, RoomConfig } from './types.ts'

export const MAX_INSTANCES = 8000

export const WALL_YAW: Record<MountWall, number> = {
  back: 0,
  front: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

export interface CoverInstance {
  position: THREE.Vector3
  quat: THREE.Quaternion
}

export function alignQuat(size: THREE.Vector3, kind: 'floor' | 'ceiling' | MountWall, out: THREE.Quaternion): THREE.Quaternion {
  const min = Math.min(size.x, size.y, size.z)
  if (kind === 'floor' || kind === 'ceiling') {
    if (size.y === min) out.identity()
    else if (size.x === min) out.setFromAxisAngle(Z_AXIS, Math.PI / 2)
    else out.setFromAxisAngle(X_AXIS, -Math.PI / 2)
    if (kind === 'ceiling') out.premultiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI))
    return out
  }
  const yaw = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, WALL_YAW[kind])
  if (size.z === min) out.copy(yaw)
  else if (size.x === min) out.setFromAxisAngle(Y_AXIS, Math.PI / 2).premultiply(yaw)
  else out.setFromAxisAngle(X_AXIS, Math.PI / 2).premultiply(yaw)
  return out
}

export function rotatedExtents(quat: THREE.Quaternion, size: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ax = X_AXIS.clone().multiplyScalar(size.x).applyQuaternion(quat)
  const ay = Y_AXIS.clone().multiplyScalar(size.y).applyQuaternion(quat)
  const az = Z_AXIS.clone().multiplyScalar(size.z).applyQuaternion(quat)
  return out.set(
    Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x),
    Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y),
    Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z),
  )
}

export function computeCoverInstances(room: RoomConfig, cover: CoverConfig, size: THREE.Vector3): CoverInstance[] {
  const instances: CoverInstance[] = []
  const quat = new THREE.Quaternion()
  const ext = new THREE.Vector3()

  if (cover.floor) {
    alignQuat(size, 'floor', quat)
    rotatedExtents(quat, size, ext)
    const nx = Math.max(1, Math.ceil(room.width / ext.x))
    const nz = Math.max(1, Math.ceil(room.depth / ext.z))
    for (let i = 0; i < nx && instances.length < MAX_INSTANCES; i++) {
      for (let j = 0; j < nz && instances.length < MAX_INSTANCES; j++) {
        instances.push({
          quat: quat.clone(),
          position: new THREE.Vector3(
            -room.width / 2 + ext.x / 2 + i * ext.x,
            ext.y / 2,
            -room.depth / 2 + ext.z / 2 + j * ext.z,
          ),
        })
      }
    }
  }

  if (cover.ceiling) {
    alignQuat(size, 'ceiling', quat)
    rotatedExtents(quat, size, ext)
    const nx = Math.max(1, Math.ceil(room.width / ext.x))
    const nz = Math.max(1, Math.ceil(room.depth / ext.z))
    for (let i = 0; i < nx && instances.length < MAX_INSTANCES; i++) {
      for (let j = 0; j < nz && instances.length < MAX_INSTANCES; j++) {
        instances.push({
          quat: quat.clone(),
          position: new THREE.Vector3(
            -room.width / 2 + ext.x / 2 + i * ext.x,
            room.height - ext.y / 2,
            -room.depth / 2 + ext.z / 2 + j * ext.z,
          ),
        })
      }
    }
  }

  if (cover.walls) {
    const walls: MountWall[] = ['back', 'front', 'left', 'right']
    for (const wall of walls) {
      if (instances.length >= MAX_INSTANCES) break
      alignQuat(size, wall, quat)
      rotatedExtents(quat, size, ext)
      const horizontal = wall === 'back' || wall === 'front'
      const span = horizontal ? room.width : room.depth
      const hExt = horizontal ? ext.x : ext.z
      const tExt = horizontal ? ext.z : ext.x
      const nu = Math.max(1, Math.ceil(span / hExt))
      const nv = Math.max(1, Math.ceil(room.height / ext.y))
      for (let i = 0; i < nu && instances.length < MAX_INSTANCES; i++) {
        for (let j = 0; j < nv && instances.length < MAX_INSTANCES; j++) {
          const u = -span / 2 + hExt / 2 + i * hExt
          const v = ext.y / 2 + j * ext.y
          const t = tExt / 2
          const position = horizontal
            ? new THREE.Vector3(u, v, wall === 'back' ? -room.depth / 2 + t : room.depth / 2 - t)
            : new THREE.Vector3(wall === 'left' ? -room.width / 2 + t : room.width / 2 - t, v, u)
          instances.push({ quat: quat.clone(), position })
        }
      }
    }
  }

  return instances
}

export function computePatchClones(
  source: THREE.Object3D,
  size: THREE.Vector3,
  center: THREE.Vector3,
  scale: number,
  grid: number,
): THREE.Object3D[] {
  const quat = new THREE.Quaternion()
  alignQuat(size, 'back', quat)
  const ext = rotatedExtents(quat, size, new THREE.Vector3())
  const rotatedCenter = center.clone().applyQuaternion(quat)
  const clones: THREE.Object3D[] = []
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const clone = source.clone()
      clone.scale.setScalar(scale)
      clone.quaternion.copy(quat)
      clone.position.set(
        (i - (grid - 1) / 2) * ext.x - rotatedCenter.x,
        ext.y / 2 + j * ext.y - rotatedCenter.y,
        -rotatedCenter.z,
      )
      clones.push(clone)
    }
  }
  return clones
}
