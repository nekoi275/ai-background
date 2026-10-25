import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export interface RoomConfig {
  width: number
  height: number
  depth: number
}

export interface TableConfig {
  visible: boolean
  size: number
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
  frameProduct(): void
  captureSize(): { width: number; height: number }
  captureView(): string
  captureDepth(): string
  capturePlate(): string
  captureReflection(): string | null
  captureShadow(): string | null
}

const CAPTURE_SIZE = 1024
const CAPTURE_MIN_SIDE = 512
const FOV = 50
const WALL_COLOR = 0xede9e1
const CEILING_COLOR = 0xf4f1eb
const FLOOR_COLOR = 0xdcd5c9
const TABLE_COLOR = 0xe3d8c6
const BACKDROP_COLOR = 0xf0eeeb

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

  const roomMaterials = [
    wall(), wall(),
    new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85 }),
    wall(), wall(),
  ]
  function wall() {
    return new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.9, side: THREE.BackSide })
  }
  const roomMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), roomMaterials)

  const tableMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.8 }),
  )
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

  const depthUniforms = {
    uNear: { value: 0.1 },
    uFar: { value: 10 },
  }
  const depthVertex = `
    varying float vDistance;
    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vDistance = length(viewPosition.xyz);
      gl_Position = projectionMatrix * viewPosition;
    }`
  const depthMaterial = new THREE.ShaderMaterial({
    uniforms: depthUniforms,
    side: THREE.DoubleSide,
    vertexShader: depthVertex,
    fragmentShader: `
      uniform float uNear;
      uniform float uFar;
      varying float vDistance;
      void main() {
        float closeness = clamp((uFar - vDistance) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(closeness), 1.0);
      }`,
  })

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

  function farthestCornerDistance(origin: THREE.Vector3): number {
    let far = 0
    for (const x of [-room.width / 2, room.width / 2]) {
      for (const y of [0, room.height]) {
        for (const z of [-room.depth / 2, room.depth / 2]) {
          far = Math.max(far, origin.distanceTo(new THREE.Vector3(x, y, z)))
        }
      }
    }
    return far
  }

  function captureDims(): { width: number; height: number } {
    const aspect = Math.min(Math.max(camera.aspect, 0.5), 2)
    if (aspect >= 1) {
      return { width: CAPTURE_SIZE, height: Math.max(CAPTURE_MIN_SIDE, Math.round(CAPTURE_SIZE / aspect)) }
    }
    return { width: Math.max(CAPTURE_MIN_SIDE, Math.round(CAPTURE_SIZE * aspect)), height: CAPTURE_SIZE }
  }

  function renderCapture(width: number, height: number, setup: () => void, teardown: () => void): string {
    const pixelRatio = renderer.getPixelRatio()
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = camera.aspect
    const background = scene.background
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()

    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    setup()
    renderer.render(scene, camera)
    const dataUrl = canvas.toDataURL('image/png')
    teardown()

    scene.background = background
    renderer.setClearColor(clearColor, clearAlpha)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size.width, size.height, false)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    return dataUrl
  }

  function productOnlyPass(): { setup: () => void; teardown: () => void } {
    return {
      setup: () => {
        roomMesh.visible = false
        tableMesh.visible = false
        scene.background = null
        renderer.setClearColor(0x000000, 0)
      },
      teardown: () => {
        roomMesh.visible = true
        tableMesh.visible = table.visible
        renderer.setClearColor(0x000000, 1)
      },
    }
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

    frameProduct() {
      const box = new THREE.Box3().setFromObject(productRoot)
      if (box.isEmpty()) return
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const halfAngle = THREE.MathUtils.degToRad(FOV / 2)
      const distance =
        Math.max(size.y / 2 / Math.tan(halfAngle), size.x / 2 / Math.tan(halfAngle)) * 1.6
      const direction = new THREE.Vector3(0.35, 0.35, 1).normalize()
      camera.position.copy(center).addScaledVector(direction, distance)
      clampPoint(camera.position)
      controls.target.copy(center)
      clampPoint(controls.target)
      controls.update()
    },

    captureSize() {
      return captureDims()
    },

    captureView() {
      const dims = captureDims()
      return renderCapture(dims.width, dims.height, () => {}, () => {})
    },

    captureDepth() {
      const swaps = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
      depthUniforms.uFar.value = farthestCornerDistance(camera.position) * 1.05
      const dims = captureDims()
      productRoot.visible = false
      try {
        return renderCapture(dims.width, dims.height, () => {
          scene.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (!mesh.isMesh) return
            swaps.set(mesh, mesh.material)
            mesh.material = depthMaterial
          })
          scene.background = null
        }, () => {
          for (const [mesh, material] of swaps) mesh.material = material
        })
      } finally {
        productRoot.visible = true
      }
    },

    capturePlate() {
      const dims = captureDims()
      const pass = productOnlyPass()
      return renderCapture(dims.width, dims.height, pass.setup, pass.teardown)
    },

    captureReflection() {
      try {
        const dims = captureDims()
        const sideSaves: { material: THREE.Material; side: THREE.Side }[] = []
        const cullSaves: [THREE.Object3D, boolean][] = []
        productRoot.traverse((node) => {
          cullSaves.push([node, node.frustumCulled])
          node.frustumCulled = false
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            sideSaves.push({ material, side: material.side })
            material.side = THREE.DoubleSide
          }
        })
        productRoot.scale.y = -1
        productRoot.updateMatrixWorld()
        const pass = productOnlyPass()
        try {
          return renderCapture(dims.width, dims.height, pass.setup, pass.teardown)
        } finally {
          productRoot.scale.y = 1
          productRoot.updateMatrixWorld()
          for (const [node, culled] of cullSaves) node.frustumCulled = culled
          for (const { material, side } of sideSaves) material.side = side
        }
      } catch {
        return null
      }
    },

    captureShadow() {
      if (!hasModelProduct) return null
      try {
        const bbox = new THREE.Box3().setFromObject(productRoot)
        const size = bbox.getSize(new THREE.Vector3())
        const half = Math.max(size.x, size.z) * 0.8 + 1
        const dims = captureDims()

        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(40, 40),
          new THREE.ShadowMaterial({ opacity: 1 }),
        )
        shadowPlane.rotation.x = -Math.PI / 2
        shadowPlane.receiveShadow = true
        shadowPlane.frustumCulled = false
        productRoot.add(shadowPlane)

        const ghost = new THREE.MeshBasicMaterial({ colorWrite: false })
        const matSaves: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = []
        const cullSaves: [THREE.Object3D, boolean][] = []
        productRoot.traverse((node) => {
          cullSaves.push([node, node.frustumCulled])
          node.frustumCulled = false
          const mesh = node as THREE.Mesh
          if (mesh.isMesh && mesh !== shadowPlane) {
            matSaves.push({ mesh, material: mesh.material })
            mesh.material = ghost
          }
        })

        const savedLightVis: [THREE.Object3D, boolean][] = []
        scene.traverse((node) => {
          if ((node as THREE.Light).isLight) {
            savedLightVis.push([node, node.visible])
            node.visible = false
          }
        })
        const shadowLight = new THREE.DirectionalLight(0xffffff, 1.5)
        shadowLight.position.set(
          productRoot.position.x + 1.2,
          productRoot.position.y + 7,
          productRoot.position.z + 0.8,
        )
        shadowLight.target.position.copy(productRoot.position)
        shadowLight.castShadow = true
        shadowLight.shadow.mapSize.set(1024, 1024)
        shadowLight.shadow.camera.near = 1
        shadowLight.shadow.camera.far = 16 + half * 2
        shadowLight.shadow.camera.left = -half
        shadowLight.shadow.camera.right = half
        shadowLight.shadow.camera.top = half
        shadowLight.shadow.camera.bottom = -half
        shadowLight.shadow.bias = -0.0005
        shadowLight.shadow.radius = 5
        shadowLight.shadow.camera.updateProjectionMatrix()
        scene.add(shadowLight, shadowLight.target)

        const pass = productOnlyPass()
        try {
          return renderCapture(dims.width, dims.height, () => {
            renderer.shadowMap.needsUpdate = true
            pass.setup()
          }, pass.teardown)
        } finally {
          scene.remove(shadowLight, shadowLight.target)
          for (const [node, visible] of savedLightVis) node.visible = visible
          for (const { mesh, material } of matSaves) mesh.material = material
          ghost.dispose()
          productRoot.remove(shadowPlane)
          shadowPlane.geometry.dispose()
          ;(shadowPlane.material as THREE.Material).dispose()
          for (const [node, culled] of cullSaves) node.frustumCulled = culled
        }
      } catch {
        return null
      }
    },
  }

  applyRoom()
  applyTable()
  resize()
  return view
}
