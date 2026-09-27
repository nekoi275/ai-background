import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export interface CameraAngle {
  azimuth: number
  elevation: number
}

const PLATE_SIZE = 1024

export interface ModelScene {
  loadModel(file: File): Promise<boolean>
  getCameraAngle(): CameraAngle
  captureView(): string
  capturePlate(): string
  captureDepth(): string
  captureShadow(): string
  getLightScreenSide(): 'left' | 'right'
  setRoomCorner(distance: number | null): void
}

export function createModelScene(root: HTMLElement): ModelScene {
  const hint = root.querySelector<HTMLElement>('.scene__hint')!
  const hintTitle = root.querySelector<HTMLElement>('.scene__hint-title')!
  const hintText = root.querySelector<HTMLElement>('.scene__hint-text')!
  const hud = root.querySelector<HTMLElement>('.scene__hud')!
  const hudAzimuth = root.querySelector<HTMLElement>('.hud__azimuth')!
  const hudElevation = root.querySelector<HTMLElement>('.hud__elevation')!

  const canvas = document.createElement('canvas')
  canvas.className = 'scene__canvas'
  root.prepend(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf3f4f6)

  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(2.8, 2.0, 2.8)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.minDistance = 1.2
  controls.maxDistance = 15
  controls.addEventListener('change', updateHud)

  const directional = new THREE.DirectionalLight(0xffffff, 1.4)
  directional.position.set(4, 12, 3)
  directional.castShadow = true
  directional.shadow.mapSize.set(2048, 2048)
  directional.shadow.camera.left = -6
  directional.shadow.camera.right = 6
  directional.shadow.camera.top = 6
  directional.shadow.camera.bottom = -6
  directional.shadow.camera.near = 1
  directional.shadow.camera.far = 30
  scene.add(directional, new THREE.HemisphereLight(0xffffff, 0xdde3ec, 0.5))

  const grid = new THREE.GridHelper(10, 20, 0xcfd4dc, 0xe6e9ef)
  scene.add(grid)

  const shadowFloor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  shadowFloor.rotation.x = -Math.PI / 2
  shadowFloor.receiveShadow = true
  scene.add(shadowFloor)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshBasicMaterial(),
  )
  ground.rotation.x = -Math.PI / 2
  ground.visible = false
  scene.add(ground)

  const CEILING_HEIGHT = 6
  let cornerDistance: number | null = null
  const roomMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
  })
  const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), roomMaterial)
  const wallSide = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), roomMaterial)
  wallSide.rotation.y = Math.PI / 2
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), roomMaterial)
  ceiling.rotation.x = Math.PI / 2
  const room = new THREE.Group()
  room.add(wallBack, wallSide, ceiling)
  room.visible = false
  scene.add(room)
  room.traverse((object) => {
    object.receiveShadow = true
  })

  function updateRoom() {
    if (cornerDistance === null) {
      room.visible = false
      return
    }
    const d = cornerDistance
    wallBack.position.set(0, CEILING_HEIGHT / 2, -d)
    wallSide.position.set(-d, CEILING_HEIGHT / 2, 0)
    ceiling.position.set(0, CEILING_HEIGHT, 0)
    wallBack.visible = camera.position.z > -d
    wallSide.visible = camera.position.x > -d
    ceiling.visible = camera.position.y < CEILING_HEIGHT
    room.visible = true
  }

  const depthMaterial = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.5 }, uFar: { value: 40 } },
    vertexShader: `
      varying float vDistance;
      void main() {
        vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
        vDistance = -viewPos.z;
        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: `
      varying float vDistance;
      uniform float uNear;
      uniform float uFar;
      void main() {
        float t = clamp((vDistance - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0 - t), 1.0);
      }
    `,
  })

  const shadowCatchMaterial = new THREE.ShadowMaterial({ opacity: 1 })

  new ResizeObserver(resize).observe(root)

  renderer.setAnimationLoop(() => {
    controls.update()
    updateRoom()
    renderer.render(scene, camera)
  })

  const loader = new GLTFLoader()
  let model: THREE.Group | null = null
  let loadToken = 0

  function resize() {
    const width = root.clientWidth
    const height = root.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function updateHud() {
    const { azimuth, elevation } = getCameraAngle()
    hudAzimuth.textContent = `${Math.round(azimuth)}°`
    hudElevation.textContent = `${Math.round(elevation)}°`
  }

  async function loadModel(file: File): Promise<boolean> {
    const token = ++loadToken
    showHint('Loading model…', file.name)

    const url = URL.createObjectURL(file)
    try {
      const gltf = await loader.loadAsync(url)
      if (token !== loadToken) return false
      setModel(gltf)
      return true
    } catch {
      if (token === loadToken) {
        showHint('Failed to load model', 'The file is corrupted or uses an unsupported format')
      }
      return false
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function setModel(gltf: GLTF) {
    disposeModel()

    const next = gltf.scene
    const box = new THREE.Box3().setFromObject(next)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    next.scale.setScalar(2.4 / maxDim)

    const fitted = new THREE.Box3().setFromObject(next)
    const center = fitted.getCenter(new THREE.Vector3())
    next.position.x -= center.x
    next.position.z -= center.z
    next.position.y -= fitted.min.y

    scene.add(next)
    model = next
    model.traverse((object) => {
      object.castShadow = true
    })

    camera.position.set(2.8, 2.0, 2.8)
    controls.target.set(0, (fitted.max.y - fitted.min.y) / 2, 0)
    controls.update()

    hint.hidden = true
    hud.hidden = false
    updateHud()
  }

  function disposeModel() {
    if (!model) return
    scene.remove(model)
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
    model = null
  }

  function showHint(title: string, text: string) {
    hintTitle.textContent = title
    hintText.textContent = text
    hint.hidden = false
    hud.hidden = true
  }

  function getCameraAngle(): CameraAngle {
    return {
      azimuth: THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()),
      elevation: 90 - THREE.MathUtils.radToDeg(controls.getPolarAngle()),
    }
  }

  function captureView(): string {
    renderer.render(scene, camera)
    return canvas.toDataURL('image/png')
  }

  function withSquareRender(setup: () => void, teardown: () => void): string {
    const background = scene.background
    const pixelRatio = renderer.getPixelRatio()
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = camera.aspect

    renderer.setPixelRatio(1)
    renderer.setSize(PLATE_SIZE, PLATE_SIZE, false)
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

  function capturePlate(): string {
    return withSquareRender(
      () => {
        scene.background = null
        grid.visible = false
        shadowFloor.visible = false
        room.visible = false
      },
      () => {
        grid.visible = true
        shadowFloor.visible = true
        room.visible = cornerDistance !== null
      },
    )
  }

  function captureDepth(): string {
    return withSquareRender(
      () => {
        scene.background = new THREE.Color(0x000000)
        grid.visible = false
        shadowFloor.visible = false
        ground.visible = true
        if (model) model.visible = false
        scene.overrideMaterial = depthMaterial
      },
      () => {
        if (model) model.visible = true
        grid.visible = true
        shadowFloor.visible = true
        ground.visible = false
        scene.overrideMaterial = null
      },
    )
  }

  function captureShadow(): string {
    return withSquareRender(
      () => {
        scene.background = null
        grid.visible = false
        ground.visible = false
        room.visible = false
        scene.overrideMaterial = shadowCatchMaterial
      },
      () => {
        grid.visible = true
        ground.visible = false
        room.visible = cornerDistance !== null
        scene.overrideMaterial = null
      },
    )
  }

  function getLightScreenSide(): 'left' | 'right' {
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize()
    const toLight = new THREE.Vector3().subVectors(directional.position, controls.target)
    return right.dot(toLight) >= 0 ? 'right' : 'left'
  }

  function setRoomCorner(distance: number | null) {
    cornerDistance = distance
    updateRoom()
  }

  return {
    loadModel,
    getCameraAngle,
    captureView,
    capturePlate,
    captureDepth,
    captureShadow,
    getLightScreenSide,
    setRoomCorner,
  }
}
