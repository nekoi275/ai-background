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
  directional.position.set(3, 6, 4)
  scene.add(directional, new THREE.HemisphereLight(0xffffff, 0xdde3ec, 0.5))

  const grid = new THREE.GridHelper(10, 20, 0xcfd4dc, 0xe6e9ef)
  scene.add(grid)

  new ResizeObserver(resize).observe(root)

  renderer.setAnimationLoop(() => {
    controls.update()
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

  function capturePlate(): string {
    const background = scene.background
    const pixelRatio = renderer.getPixelRatio()
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = camera.aspect

    scene.background = null
    grid.visible = false
    renderer.setPixelRatio(1)
    renderer.setSize(PLATE_SIZE, PLATE_SIZE, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    const dataUrl = canvas.toDataURL('image/png')

    scene.background = background
    grid.visible = true
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size.width, size.height, false)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    return dataUrl
  }

  return { loadModel, getCameraAngle, captureView, capturePlate }
}
