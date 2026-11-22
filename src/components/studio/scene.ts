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
import type { RoomConfig, StudioScene, TableConfig, TableShape } from './types.ts'

const FOV = 50
const REF_SIZE = 768

const tableGeometry: Record<TableShape, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
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
  scene.add(roomMesh, tableMesh, productRoot)

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
    tableMesh.visible = table.visible
    placeProduct()
  }

  function placeProduct(): void {
    productRoot.position.set(table.x, table.visible ? table.height : 0, table.z)
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

  const view: StudioScene = {
    setRoom(next) {
      Object.assign(room, next)
      applyRoom()
    },

    setTable(next) {
      Object.assign(table, next)
      applyTable()
    },

    setProduct(product) {
      disposeProduct()
      if (!product) return
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
    },

    captureSize() {
      return calculateCaptureDims(camera)
    },

    captureView() {
      const dims = calculateCaptureDims(camera)
      return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height)
    },

    captureProductReference() {
      const box = new THREE.Box3().setFromObject(productRoot)
      if (box.isEmpty()) return ''
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
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

  applyRoom()
  applyTable()
  resize()
  return view
}
