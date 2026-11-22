import { clampMountToRoom, clampTableToRoom } from '../components/studio/clamp.ts'
import type {
  CoverConfig,
  MountConfig,
  MountWall,
  Placement,
  RoomConfig,
  StudioScene,
  TableConfig,
  TableShape,
} from '../components/studio/index.ts'
import { $ } from '../lib/dom.ts'
import { formatSize } from '../lib/format.ts'
import type { LoadedProduct } from '../product.ts'
import { setupSliderArrows, updateSliderArrows } from './slider-arrows.ts'

const roomInputs = {
  width: $<HTMLInputElement>('room-width'),
  height: $<HTMLInputElement>('room-height'),
  depth: $<HTMLInputElement>('room-depth'),
}
const tableInputs = {
  visible: $<HTMLInputElement>('table-visible'),
  shape: $<HTMLSelectElement>('table-shape'),
  width: $<HTMLInputElement>('table-width'),
  depth: $<HTMLInputElement>('table-depth'),
  height: $<HTMLInputElement>('table-height'),
  x: $<HTMLInputElement>('table-x'),
  z: $<HTMLInputElement>('table-z'),
}
const tableControls = $('table-controls')
const placementBlock = $('placement-block')
const placementSelect = $<HTMLSelectElement>('product-placement')
const photoSurfaces = $('photo-surfaces')
const photoSurfaceInputs = {
  walls: $<HTMLInputElement>('photo-surface-walls'),
  floor: $<HTMLInputElement>('photo-surface-floor'),
  ceiling: $<HTMLInputElement>('photo-surface-ceiling'),
}
const tableTitle = $('table-title')
const tableToggle = $('table-toggle')
const mountTitle = $('mount-title')
const mountControls = $('mount-controls')
const mountWallRow = $('mount-wall-row')
const mountHeightRow = $('mount-height-row')
const mountOffsetZRow = $('mount-offset-z-row')
const mountWall = $<HTMLSelectElement>('mount-wall')
const mountInputs = {
  height: $<HTMLInputElement>('mount-height'),
  offset: $<HTMLInputElement>('mount-offset'),
  offsetZ: $<HTMLInputElement>('mount-offset-z'),
  yaw: $<HTMLInputElement>('mount-yaw'),
}
const coverTitle = $('cover-title')
const coverControls = $('cover-controls')
const coverHint = $('cover-hint')
const coverInputs = {
  walls: $<HTMLInputElement>('cover-walls'),
  floor: $<HTMLInputElement>('cover-floor'),
  ceiling: $<HTMLInputElement>('cover-ceiling'),
}
const productScale = $<HTMLInputElement>('product-scale')
const scaleDims = $('scale-dims')

export interface SceneFormDeps {
  scene: StudioScene
  product: () => LoadedProduct | null
}

export interface SceneForm {
  apply(): void
  reset(): void
  syncPlacementUI(): void
  readonly placement: Placement
  coverSurfaces(): string[]
}

export function setupSceneForm(deps: SceneFormDeps): SceneForm {
  let placement: Placement = 'floor'
  let coverCfg: CoverConfig = { walls: true, floor: false, ceiling: false }
  let lastAppliedPlacement: Placement = 'floor'
  let lastCoverCfg: CoverConfig = { walls: true, floor: false, ceiling: false }
  let lastScale = 1

  function currentRoom(): RoomConfig {
    return {
      width: Number(roomInputs.width.value),
      height: Number(roomInputs.height.value),
      depth: Number(roomInputs.depth.value),
    }
  }

  function currentTable(): TableConfig {
    return {
      visible: tableInputs.visible.checked,
      shape: tableInputs.shape.value as TableShape,
      width: Number(tableInputs.width.value),
      depth: Number(tableInputs.depth.value),
      height: Number(tableInputs.height.value),
      x: Number(tableInputs.x.value),
      z: Number(tableInputs.z.value),
    }
  }

  function currentMount(): MountConfig {
    return {
      wall: mountWall.value as MountWall,
      height: Number(mountInputs.height.value),
      offset: Number(mountInputs.offset.value),
      offsetZ: Number(mountInputs.offsetZ.value),
      yaw: Number(mountInputs.yaw.value),
    }
  }

  function syncControlOutputs(): void {
    setOut('room-width', `${Number(roomInputs.width.value).toFixed(1)} m`)
    setOut('room-height', `${Number(roomInputs.height.value).toFixed(1)} m`)
    setOut('room-depth', `${Number(roomInputs.depth.value).toFixed(1)} m`)
    setOut('table-width', `${Number(tableInputs.width.value).toFixed(2)} m`)
    setOut('table-depth', `${Number(tableInputs.depth.value).toFixed(2)} m`)
    setOut('table-height', `${Number(tableInputs.height.value).toFixed(2)} m`)
    setOut('table-x', `${Number(tableInputs.x.value).toFixed(2)} m`)
    setOut('table-z', `${Number(tableInputs.z.value).toFixed(2)} m`)
    setOut('mount-height', `${Number(mountInputs.height.value).toFixed(2)} m`)
    setOut('mount-offset', `${Number(mountInputs.offset.value).toFixed(2)} m`)
    setOut('mount-offset-z', `${Number(mountInputs.offsetZ.value).toFixed(2)} m`)
    setOut('mount-yaw', `${Number(mountInputs.yaw.value)}°`)
    const scale = Number(productScale.value) / 100
    setOut('product-scale', `×${scale.toFixed(2)}`)
    const product = deps.product()
    if (product?.size) {
      const s = product.size
      scaleDims.textContent = formatSize({ x: s.x * scale, y: s.y * scale, z: s.z * scale })
    } else {
      scaleDims.textContent = ''
    }
  }

  function readCoverInputs(): CoverConfig {
    const source = photoSurfaces.hidden ? coverInputs : photoSurfaceInputs
    return {
      walls: source.walls.checked,
      floor: source.floor.checked,
      ceiling: source.ceiling.checked,
    }
  }

  function syncCoverInputs(): void {
    for (const key of ['walls', 'floor', 'ceiling'] as const) {
      photoSurfaceInputs[key].checked = coverCfg[key]
      coverInputs[key].checked = coverCfg[key]
    }
  }

  function coverSurfaces(): string[] {
    return (['walls', 'floor', 'ceiling'] as const).filter((surface) => coverCfg[surface])
  }

  function syncPlacementUI(): void {
    const product = deps.product()
    placementBlock.hidden = !product
    const isPhoto = product?.kind === 'photo'
    const isModel = product?.kind === 'model'
    photoSurfaces.hidden = !isPhoto || placement !== 'cover'
    tableTitle.hidden = !isModel || placement === 'cover'
    tableToggle.hidden = tableTitle.hidden
    mountTitle.hidden = !isModel || (placement !== 'wall' && placement !== 'ceiling')
    mountControls.hidden = mountTitle.hidden
    mountWallRow.hidden = placement !== 'wall'
    mountHeightRow.hidden = placement !== 'wall'
    mountOffsetZRow.hidden = placement !== 'ceiling'
    coverTitle.hidden = !isModel || placement !== 'cover'
    coverControls.hidden = coverTitle.hidden
    coverHint.hidden = coverTitle.hidden
  }

  function apply(): void {
    const room = currentRoom()
    const table = clampTableToRoom(room, currentTable())
    const mount = clampMountToRoom(room, currentMount(), placement)
    syncControlOutputs()
    tableInputs.x.min = String(-room.width / 2)
    tableInputs.x.max = String(room.width / 2)
    tableInputs.z.min = String(-room.depth / 2)
    tableInputs.z.max = String(room.depth / 2)
    tableInputs.width.value = String(table.width)
    tableInputs.depth.value = String(table.depth)
    tableInputs.height.value = String(table.height)
    tableInputs.x.value = String(table.x)
    tableInputs.z.value = String(table.z)
    const horizontal = mount.wall === 'back' || mount.wall === 'front'
    mountInputs.height.max = String(room.height)
    if (placement === 'wall') {
      const span = horizontal ? room.width : room.depth
      mountInputs.offset.min = String(-span / 2)
      mountInputs.offset.max = String(span / 2)
      mountInputs.offsetZ.min = '0'
      mountInputs.offsetZ.max = '0'
    } else {
      mountInputs.offset.min = String(-room.width / 2)
      mountInputs.offset.max = String(room.width / 2)
      mountInputs.offsetZ.min = String(-room.depth / 2)
      mountInputs.offsetZ.max = String(room.depth / 2)
    }
    mountInputs.height.value = String(mount.height)
    mountInputs.offset.value = String(mount.offset)
    mountInputs.offsetZ.value = String(mount.offsetZ)
    tableControls.classList.toggle('controls__group--disabled', !table.visible)
    deps.scene.setRoom(room)
    deps.scene.setTable(table)
    deps.scene.setMount(mount)
    const scale = Number(productScale.value) / 100
    if (lastScale !== scale) {
      deps.scene.setScale(scale)
      lastScale = scale
    }
    if (lastAppliedPlacement !== placement) {
      deps.scene.setPlacement(placement)
      lastAppliedPlacement = placement
    }
    if (
      lastCoverCfg.walls !== coverCfg.walls ||
      lastCoverCfg.floor !== coverCfg.floor ||
      lastCoverCfg.ceiling !== coverCfg.ceiling
    ) {
      deps.scene.setCover(coverCfg)
      lastCoverCfg = { ...coverCfg }
    }
    updateSliderArrows()
  }

  function reset(): void {
    placement = 'floor'
    placementSelect.value = 'floor'
    coverCfg = { walls: true, floor: false, ceiling: false }
    lastAppliedPlacement = 'floor'
    lastCoverCfg = { walls: true, floor: false, ceiling: false }
    lastScale = 1
    productScale.value = '100'
    deps.scene.setScale(1)
    deps.scene.setPlacement('floor')
    syncCoverInputs()
    syncPlacementUI()
    apply()
  }

  for (const input of Object.values(roomInputs)) {
    input.addEventListener('input', apply)
  }
  for (const input of Object.values(tableInputs)) {
    input.addEventListener('input', apply)
  }
  for (const input of Object.values(mountInputs)) {
    input.addEventListener('input', apply)
  }
  productScale.addEventListener('input', apply)
  mountWall.addEventListener('change', apply)
  placementSelect.addEventListener('change', () => {
    placement = placementSelect.value as Placement
    syncPlacementUI()
    apply()
  })
  for (const input of [...Object.values(photoSurfaceInputs), ...Object.values(coverInputs)]) {
    input.addEventListener('change', () => {
      coverCfg = readCoverInputs()
      syncCoverInputs()
      apply()
    })
  }
  setupSliderArrows()

  return {
    apply,
    reset,
    syncPlacementUI,
    get placement() {
      return placement
    },
    coverSurfaces,
  }
}

function setOut(id: string, text: string): void {
  const out = document.querySelector<HTMLElement>(`[data-out="${id}"]`)
  if (out) out.textContent = text
}
