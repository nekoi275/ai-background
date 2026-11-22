import * as THREE from 'three'

export const CAPTURE_SIZE = 1024
export const CAPTURE_MIN_SIDE = 512

export interface RenderContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  roomMesh: THREE.Mesh
  tableMesh: THREE.Mesh
  productRoot: THREE.Group
}

export function calculateCaptureDims(camera: THREE.PerspectiveCamera): { width: number; height: number } {
  const aspect = Math.min(Math.max(camera.aspect, 0.5), 2)
  if (aspect >= 1) {
    return {
      width: CAPTURE_SIZE,
      height: Math.max(CAPTURE_MIN_SIDE, Math.round(CAPTURE_SIZE / aspect)),
    }
  }
  return {
    width: Math.max(CAPTURE_MIN_SIDE, Math.round(CAPTURE_SIZE * aspect)),
    height: CAPTURE_SIZE,
  }
}

export function renderCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  setup: () => void,
  teardown: () => void,
): string {
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

export function createProductOnlyPass(
  context: RenderContext,
  tableVisible: boolean,
): { setup: () => void; teardown: () => void } {
  const { renderer, scene, roomMesh, tableMesh } = context
  return {
    setup: () => {
      roomMesh.visible = false
      tableMesh.visible = false
      scene.background = null
      renderer.setClearColor(0x000000, 0)
    },
    teardown: () => {
      roomMesh.visible = true
      tableMesh.visible = tableVisible
      renderer.setClearColor(0x000000, 1)
    },
  }
}

export function capturePlatePass(context: RenderContext, tableVisible: boolean): string {
  const { renderer, scene, camera, canvas } = context
  const dims = calculateCaptureDims(camera)
  const pass = createProductOnlyPass(context, tableVisible)
  return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height, pass.setup, pass.teardown)
}