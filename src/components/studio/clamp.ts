import type { MountConfig, Placement, RoomConfig, TableConfig } from './types.ts'

export function clampTableToRoom(room: RoomConfig, table: TableConfig): TableConfig {
  const snap = (value: number, limit: number) => Math.round(Math.min(value, limit) * 20) / 20
  table.width = snap(table.width, room.width)
  table.depth = snap(table.depth, room.depth)
  table.height = snap(table.height, room.height)
  const halfX = Math.max(0, room.width / 2 - table.width / 2)
  const halfZ = Math.max(0, room.depth / 2 - table.depth / 2)
  table.x = Math.min(halfX, Math.max(-halfX, table.x))
  table.z = Math.min(halfZ, Math.max(-halfZ, table.z))
  return table
}

export function clampMountToRoom(room: RoomConfig, mount: MountConfig, placement: Placement): MountConfig {
  const snap = (value: number, limit: number) => Math.round(Math.min(limit, Math.max(-limit, value)) * 20) / 20
  mount.height = Math.max(0.05, Math.round(Math.min(mount.height, room.height) * 20) / 20)
  const horizontal = mount.wall === 'back' || mount.wall === 'front'
  if (placement === 'wall') {
    mount.offset = snap(mount.offset, horizontal ? room.width / 2 : room.depth / 2)
    mount.offsetZ = 0
  } else {
    mount.offset = snap(mount.offset, room.width / 2)
    mount.offsetZ = snap(mount.offsetZ, room.depth / 2)
  }
  return mount
}
