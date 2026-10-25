import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
  captureView(): string
  captureDepth(): string
  capturePlate(): string
}

const CAPTURE_SIZE = 1024
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
  const billboardDepthMaterial = new THREE.ShaderMaterial({
    uniforms: { uNear: depthUniforms.uNear, uFar: depthUniforms.uFar, map: { value: null } },
    vertexShader: `
      varying float vDistance;
      varying vec2 vUv;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vDistance = length(viewPosition.xyz);
        vUv = uv;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uNear;
      uniform float uFar;
      varying float vDistance;
      varying vec2 vUv;
      void main() {
        if (texture2D(map, vUv).a < 0.5) discard;
        float closeness = clamp((uFar - vDistance) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(closeness), 1.0);
      }`,
  })

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

  function renderSquare(setup: () => void, teardown: () => void): string {
    const pixelRatio = renderer.getPixelRatio()
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = camera.aspect
    const background = scene.background

    renderer.setPixelRatio(1)
    renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    setup()
    renderer.render(scene, camera)
    const dataUrl = canvas.toDataURL('image/png')
    teardown()

    scene.background = background
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size.width, size.height, false)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    return dataUrl
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
          billboardDepthMaterial.uniforms.map.value = texture
          material.needsUpdate = true
        })
      } else {
        productRoot.add(product.object)
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

    captureView() {
      return renderSquare(() => {}, () => {})
    },

    captureDepth() {
      const swaps = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
      depthUniforms.uFar.value = farthestCornerDistance(camera.position) * 1.05
      return renderSquare(
        () => {
          scene.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (!mesh.isMesh) return
            swaps.set(mesh, mesh.material)
            mesh.material = mesh === billboard ? billboardDepthMaterial : depthMaterial
          })
          scene.background = null
        },
        () => {
          for (const [mesh, material] of swaps) mesh.material = material
        },
      )
    },

    capturePlate() {
      return renderSquare(
        () => {
          roomMesh.visible = false
          tableMesh.visible = false
          scene.background = null
          renderer.setClearColor(0x000000, 0)
        },
        () => {
          roomMesh.visible = true
          tableMesh.visible = table.visible
          renderer.setClearColor(0x000000, 1)
        },
      )
    },
  }

  applyRoom()
  applyTable()
  resize()
  return view
}
