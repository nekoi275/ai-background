import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  BACKDROP_COLOR,
  createDepthMaterial,
  createRoomMaterials,
  createTableMaterial,
} from './materials.ts'
import {
  calculateCaptureDims,
  captureDepthPass,
  capturePlatePass,
  captureReflectionPass,
  captureShadowPass,
  renderCapture,
  type RenderContext,
} from './passes.ts'
import type { RoomConfig, StudioScene, TableConfig } from './types.ts'

const FOV = 50

export function createStudioScene(root: HTMLElement): StudioScene {
  const canvas = document.createElement('canvas')
  canvas.className = 'scene__canvas'
  root.prepend(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKDROP_COLOR)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 500)
  camera.position.set(2.2, 1.8, 1.6)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.2
  controls.maxDistance = 100
  controls.target.set(0, 1.1, 0)

  const roomMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createRoomMaterials())
  const tableMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createTableMaterial())
  tableMesh.visible = false

  const productRoot = new THREE.Group()
  scene.add(roomMesh, tableMesh, productRoot)

  let billboard: THREE.Mesh | null = null
  let photoAspect = 1
  let hasModelProduct = false

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bd, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.0)
  key.position.set(3, 6, 4)
  const fill = new THREE.DirectionalLight(0xffffff, 0.7)
  fill.position.set(-4, 5, -3)
  scene.add(key, fill)

  const depthContext = createDepthMaterial()

  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()

  const room: RoomConfig = { width: 5, height: 3, depth: 5 }
  const table: TableConfig = { visible: false, size: 0.6, x: 0, z: 0 }
  let photoHeight = 0.45

  new ResizeObserver(resize).observe(root)

  renderer.setAnimationLoop(() => {
    if (billboard) {
      billboard.rotation.y = Math.atan2(
        camera.position.x - productRoot.position.x,
        camera.position.z - productRoot.position.z,
      )
    }
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
  }

  function applyTable(): void {
    tableMesh.scale.setScalar(table.size)
    tableMesh.position.set(table.x, table.size / 2, table.z)
    tableMesh.visible = table.visible
    placeProduct()
  }

  function placeProduct(): void {
    productRoot.position.set(table.x, table.visible ? table.size : 0, table.z)
    if (billboard) {
      const height = photoHeight * room.height
      billboard.scale.set(height * photoAspect, height, 1)
      billboard.position.y = height / 2
    }
  }

  function disposeProduct(): void {
    hasModelProduct = false
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
    billboard = null
  }

  const renderCtx: RenderContext = {
    renderer,
    scene,
    camera,
    canvas,
    roomMesh,
    tableMesh,
    productRoot,
  }

  const view: StudioScene = {
    setRoom(next) {
      Object.assign(room, next)
      applyRoom()
      placeProduct()
    },

    setTable(next) {
      Object.assign(table, next)
      applyTable()
    },

    setProduct(product) {
      disposeProduct()
      if (!product) return
      if (product.kind === 'photo') {
        photoAspect = product.aspect
        const material = new THREE.MeshBasicMaterial({
          transparent: true,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
        billboard = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
        billboard.name = 'photo-product'
        productRoot.add(billboard)
        new THREE.TextureLoader().load(product.url, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace
          material.map = texture
          material.needsUpdate = true
        })
      } else {
        hasModelProduct = true
        productRoot.add(product.object)
        product.object.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            if ('envMapIntensity' in material) {
              ;(material as THREE.MeshStandardMaterial).envMapIntensity = 1.15
            }
          }
        })
      }
      placeProduct()
    },

    setPhotoHeight(fraction) {
      photoHeight = fraction
      placeProduct()
    },

    captureSize() {
      return calculateCaptureDims(camera)
    },

    captureView() {
      const dims = calculateCaptureDims(camera)
      return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height, () => {}, () => {})
    },

    captureDepth() {
      return captureDepthPass(renderCtx, depthContext.material, depthContext.uniforms.uFar, room)
    },

    capturePlate() {
      return capturePlatePass(renderCtx, table.visible)
    },

    captureReflection() {
      return captureReflectionPass(renderCtx, table.visible)
    },

    captureShadow() {
      return captureShadowPass(renderCtx, table.visible, hasModelProduct)
    },
  }

  applyRoom()
  applyTable()
  resize()
  return view
}
