import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  createRoomMaterials,
  createTableMaterial,
} from './materials.ts'
import {
  calculateCaptureDims,
  renderCapture,
} from './passes.ts'
import type {
  CoverConfig,
  MountConfig,
  MountWall,
  Placement,
  RoomConfig,
  StudioScene,
  TableConfig,
  TableShape,
} from './types.ts'

const FOV = 50
const REF_SIZE = 768
const PATCH_GRID = 5
const PATCH_FILL = 1.02
const MAX_INSTANCES = 8000
const DEG = Math.PI / 180

const tableGeometry: Record<TableShape, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

const wallYaw: Record<MountWall, number> = {
  back: 0,
  front: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
}

interface CoverInstance {
  position: THREE.Vector3
  quat: THREE.Quaternion
}

function alignQuat(size: THREE.Vector3, kind: 'floor' | 'ceiling' | MountWall, out: THREE.Quaternion): THREE.Quaternion {
  const min = Math.min(size.x, size.y, size.z)
  if (kind === 'floor' || kind === 'ceiling') {
    if (size.y === min) out.identity()
    else if (size.x === min) out.setFromAxisAngle(Z_AXIS, Math.PI / 2)
    else out.setFromAxisAngle(X_AXIS, -Math.PI / 2)
    if (kind === 'ceiling') out.premultiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI))
    return out
  }
  const yaw = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, wallYaw[kind])
  if (size.z === min) out.copy(yaw)
  else if (size.x === min) out.setFromAxisAngle(Y_AXIS, Math.PI / 2).premultiply(yaw)
  else out.setFromAxisAngle(X_AXIS, Math.PI / 2).premultiply(yaw)
  return out
}

function rotatedExtents(quat: THREE.Quaternion, size: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ax = X_AXIS.clone().multiplyScalar(size.x).applyQuaternion(quat)
  const ay = Y_AXIS.clone().multiplyScalar(size.y).applyQuaternion(quat)
  const az = Z_AXIS.clone().multiplyScalar(size.z).applyQuaternion(quat)
  return out.set(
    Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x),
    Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y),
    Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z),
  )
}

export function createStudioScene(root: HTMLElement): StudioScene {
  const canvas = document.createElement('canvas')
  canvas.className = 'scene__canvas'
  root.prepend(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 500)
  camera.position.set(2.2, 1.8, 1.6)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.2
  controls.maxDistance = 100
  controls.target.set(0, 1.1, 0)

  const roomMaterials = createRoomMaterials()
  const roomMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), roomMaterials.materials)
  roomMesh.receiveShadow = true
  const tableMaterial = createTableMaterial()
  const tableMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(
    tableGeometry.box,
    tableMaterial,
  )
  tableMesh.visible = false
  tableMesh.castShadow = true
  tableMesh.receiveShadow = true

  const productRoot = new THREE.Group()
  const coverRoot = new THREE.Group()
  coverRoot.visible = false
  const patchRoot = new THREE.Group()
  patchRoot.visible = false
  scene.add(roomMesh, tableMesh, productRoot, coverRoot, patchRoot)

  scene.add(
    new THREE.AmbientLight(0xffffff, 0.5),
    new THREE.HemisphereLight(0xffffff, 0x8d8579, 0.5),
  )
  const key = new THREE.DirectionalLight(0xfff0dd, 1.8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35)
  fill.position.set(-4, 5, -3)
  scene.add(key, key.target, fill)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()

  const room: RoomConfig = { width: 5, height: 3, depth: 5 }
  const table: TableConfig = { visible: false, shape: 'box', width: 0.6, depth: 0.6, height: 0.6, x: 0, z: 0 }
  let placement: Placement = 'floor'
  let scale = 1
  const mount: MountConfig = { wall: 'back', height: 1.5, offset: 0, offsetZ: 0, yaw: 0 }
  const cover: CoverConfig = { walls: true, floor: false, ceiling: false }

  new ResizeObserver(resize).observe(root)

  renderer.setAnimationLoop(() => {
    controls.update()
    clampPoint(camera.position)
    clampPoint(controls.target)
    renderer.render(scene, camera)
  })

  function resize() {
    const width = root.clientWidth
    const height = root.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function clampPoint(point: THREE.Vector3): void {
    const margin = Math.min(0.25, Math.min(room.width, room.height, room.depth) / 10)
    point.x = THREE.MathUtils.clamp(point.x, -room.width / 2 + margin, room.width / 2 - margin)
    point.y = THREE.MathUtils.clamp(point.y, margin, room.height - margin)
    point.z = THREE.MathUtils.clamp(point.z, -room.depth / 2 + margin, room.depth / 2 - margin)
  }

  function applyRoom(): void {
    roomMesh.scale.set(room.width, room.height, room.depth)
    roomMesh.position.y = room.height / 2
    const span = Math.max(room.width, room.height, room.depth)
    key.position.set(3, 6, 4).normalize().multiplyScalar(span * 1.6)
    const shadowCam = key.shadow.camera
    shadowCam.left = -span
    shadowCam.right = span
    shadowCam.top = span
    shadowCam.bottom = -span
    shadowCam.near = 0.1
    shadowCam.far = span * 4
    shadowCam.updateProjectionMatrix()
  }

  function applyTable(): void {
    if (tableMesh.geometry !== tableGeometry[table.shape]) {
      tableMesh.geometry = tableGeometry[table.shape]
    }
    tableMesh.scale.set(table.width, table.height, table.depth)
    tableMesh.position.set(table.x, table.height / 2, table.z)
    tableMesh.visible = table.visible && placement !== 'cover'
    placeProduct()
  }

  function placeProduct(): void {
    const hasProduct = productRoot.children.length > 0
    const coverReady = placement === 'cover' && coverRoot.children.length > 0
    coverRoot.visible = coverReady
    productRoot.visible = hasProduct && !coverReady
    if (!hasProduct) return
    if (placement === 'cover') {
      productRoot.position.set(0, 0, 0)
      productRoot.rotation.set(0, 0, 0)
      return
    }
    if (placement === 'floor') {
      productRoot.rotation.set(0, 0, 0)
      productRoot.position.set(table.x, table.visible ? table.height : 0, table.z)
      return
    }
    placeMounted()
  }

  function placeMounted(): void {
    productRoot.rotation.set(0, (placement === 'wall' ? wallYaw[mount.wall] : 0) + mount.yaw * DEG, 0)
    productRoot.position.set(0, 0, 0)
    productRoot.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(productRoot)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    if (placement === 'wall') {
      let dx = 0
      let dz = 0
      if (mount.wall === 'back') {
        dx = mount.offset - center.x
        dz = -room.depth / 2 - box.min.z
      } else if (mount.wall === 'front') {
        dx = mount.offset - center.x
        dz = room.depth / 2 - box.max.z
      } else if (mount.wall === 'left') {
        dx = -room.width / 2 - box.min.x
        dz = mount.offset - center.z
      } else {
        dx = room.width / 2 - box.max.x
        dz = mount.offset - center.z
      }
      productRoot.position.set(dx, mount.height - center.y, dz)
    } else {
      productRoot.position.set(
        mount.offset - center.x,
        room.height - box.max.y,
        mount.offsetZ - center.z,
      )
    }
  }

  function disposeProduct(): void {
    for (const child of [...productRoot.children]) {
      child.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          ;(material as THREE.MeshBasicMaterial).map?.dispose()
          material.dispose()
        }
      })
      productRoot.remove(child)
    }
  }

  function disposeCover(): void {
    for (const child of [...coverRoot.children]) {
      coverRoot.remove(child)
      if (child instanceof THREE.InstancedMesh) child.dispose()
    }
  }

  function disposePatch(): void {
    for (const child of [...patchRoot.children]) patchRoot.remove(child)
  }

  function localProductBox(): { box: THREE.Box3; size: THREE.Vector3; center: THREE.Vector3 } | null {
    if (!productRoot.children.length) return null
    productRoot.position.set(0, 0, 0)
    productRoot.rotation.set(0, 0, 0)
    productRoot.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(productRoot)
    if (box.isEmpty()) return null
    return {
      box,
      size: box.getSize(new THREE.Vector3()),
      center: box.getCenter(new THREE.Vector3()),
    }
  }

  function buildCover(): void {
    disposeCover()
    if (placement !== 'cover') return
    const local = localProductBox()
    if (!local) return

    const rootInverse = productRoot.matrixWorld.clone().invert()
    const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale)
    const sources: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }[] = []
    productRoot.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      sources.push({
        geometry: mesh.geometry,
        material: mesh.material,
        local: mesh.matrixWorld.clone().premultiply(rootInverse).premultiply(scaleMatrix),
      })
    })
    if (!sources.length) return

    const instances: CoverInstance[] = []
    const quat = new THREE.Quaternion()
    const ext = new THREE.Vector3()

    if (cover.floor) {
      alignQuat(local.size, 'floor', quat)
      rotatedExtents(quat, local.size, ext)
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
      alignQuat(local.size, 'ceiling', quat)
      rotatedExtents(quat, local.size, ext)
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
        alignQuat(local.size, wall, quat)
        rotatedExtents(quat, local.size, ext)
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

    if (!instances.length) return

    const correction = new THREE.Matrix4().makeTranslation(-local.center.x, -local.center.y, -local.center.z)
    const one = new THREE.Vector3(1, 1, 1)
    const matrix = new THREE.Matrix4()
    for (const source of sources) {
      const inst = new THREE.InstancedMesh(source.geometry, source.material, instances.length)
      inst.castShadow = true
      inst.receiveShadow = true
      inst.frustumCulled = false
      for (let i = 0; i < instances.length; i++) {
        matrix.compose(instances[i].position, instances[i].quat, one).multiply(correction).multiply(source.local)
        inst.setMatrixAt(i, matrix)
      }
      inst.instanceMatrix.needsUpdate = true
      coverRoot.add(inst)
    }
  }

  function buildPatch(): void {
    disposePatch()
    const local = localProductBox()
    const source = productRoot.children[0]
    if (!local || !source) return
    const quat = new THREE.Quaternion()
    alignQuat(local.size, 'back', quat)
    const ext = rotatedExtents(quat, local.size, new THREE.Vector3())
    const rotatedCenter = local.center.clone().applyQuaternion(quat)
    for (let i = 0; i < PATCH_GRID; i++) {
      for (let j = 0; j < PATCH_GRID; j++) {
        const clone = source.clone()
        clone.scale.setScalar(scale)
        clone.quaternion.copy(quat)
        clone.position.set(
          (i - (PATCH_GRID - 1) / 2) * ext.x - rotatedCenter.x,
          ext.y / 2 + j * ext.y - rotatedCenter.y,
          -rotatedCenter.z,
        )
        patchRoot.add(clone)
      }
    }
  }

  const view: StudioScene = {
    setRoom(next) {
      Object.assign(room, next)
      applyRoom()
      if (placement === 'cover') buildCover()
      placeProduct()
    },

    setTable(next) {
      Object.assign(table, next)
      applyTable()
    },

    setProduct(product) {
      disposePatch()
      disposeCover()
      disposeProduct()
      if (!product) {
        placeProduct()
        return
      }
      productRoot.add(product.object)
      product.object.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          const std = material as THREE.MeshStandardMaterial
          if ('envMapIntensity' in std) {
            std.envMap = environmentTexture
            std.envMapIntensity = 1.4
          }
        }
      })
      if (placement === 'cover') buildCover()
      placeProduct()
    },

    setPlacement(next) {
      placement = next
      if (next === 'cover') buildCover()
      else disposeCover()
      applyTable()
    },

    setMount(next) {
      Object.assign(mount, next)
      placeProduct()
    },

    setCover(next) {
      Object.assign(cover, next)
      if (placement === 'cover') buildCover()
      placeProduct()
    },

    setScale(next) {
      scale = next
      productRoot.scale.setScalar(scale)
      if (placement === 'cover') buildCover()
      placeProduct()
    },

    captureSize() {
      return calculateCaptureDims(camera)
    },

    captureView() {
      const dims = calculateCaptureDims(camera)
      return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height)
    },

    captureProductReference() {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
      if (placement === 'cover') return captureCoverReference(dir)
      const box = new THREE.Box3().setFromObject(productRoot)
      if (box.isEmpty()) return ''
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const refCamera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 500)
      refCamera.position.copy(center).addScaledVector(dir, maxDim * 1.4)
      refCamera.lookAt(center)
      const roomVisible = roomMesh.visible
      const tableVisible = tableMesh.visible
      const background = scene.background
      const clearColor = renderer.getClearColor(new THREE.Color())
      const clearAlpha = renderer.getClearAlpha()
      roomMesh.visible = false
      tableMesh.visible = false
      scene.background = new THREE.Color(0x808080)
      renderer.setClearColor(0x808080, 1)
      const url = renderCapture(renderer, scene, refCamera, canvas, REF_SIZE, REF_SIZE)
      roomMesh.visible = roomVisible
      tableMesh.visible = tableVisible
      scene.background = background
      renderer.setClearColor(clearColor, clearAlpha)
      return url
    },
  }

  function captureCoverReference(dir: THREE.Vector3): string {
    buildPatch()
    if (!patchRoot.children.length) return ''
    patchRoot.lookAt(dir)
    patchRoot.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(patchRoot)
    if (box.isEmpty()) return ''
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const minFace = Math.min(size.x, size.y)
    const refCamera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 500)
    refCamera.position.copy(center).addScaledVector(dir, minFace * PATCH_FILL)
    refCamera.lookAt(center)
    const roomVisible = roomMesh.visible
    const tableVisible = tableMesh.visible
    const coverVisible = coverRoot.visible
    const background = scene.background
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    roomMesh.visible = false
    tableMesh.visible = false
    coverRoot.visible = false
    patchRoot.visible = true
    scene.background = new THREE.Color(0x808080)
    renderer.setClearColor(0x808080, 1)
    const url = renderCapture(renderer, scene, refCamera, canvas, REF_SIZE, REF_SIZE)
    roomMesh.visible = roomVisible
    tableMesh.visible = tableVisible
    coverRoot.visible = coverVisible
    patchRoot.visible = false
    scene.background = background
    renderer.setClearColor(clearColor, clearAlpha)
    return url
  }

  applyRoom()
  applyTable()
  resize()
  return view
}
