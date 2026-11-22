import * as THREE from 'three'
import { renderCapture } from './passes.ts'

const ISOLATED_BACKGROUND = 0x808080

export interface IsolatedCaptureOptions {
  camera: THREE.PerspectiveCamera
  width: number
  height: number
  hide?: THREE.Object3D[]
  show?: THREE.Object3D[]
}

export function captureIsolated(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  canvas: HTMLCanvasElement,
  options: IsolatedCaptureOptions,
): string {
  const hidden = options.hide ?? []
  const shown = options.show ?? []
  const savedHidden = hidden.map((object) => object.visible)
  const savedShown = shown.map((object) => object.visible)
  const background = scene.background
  const clearColor = renderer.getClearColor(new THREE.Color())
  const clearAlpha = renderer.getClearAlpha()

  for (const object of hidden) object.visible = false
  for (const object of shown) object.visible = true
  scene.background = new THREE.Color(ISOLATED_BACKGROUND)
  renderer.setClearColor(ISOLATED_BACKGROUND, 1)
  const url = renderCapture(renderer, scene, options.camera, canvas, options.width, options.height)

  hidden.forEach((object, index) => {
    object.visible = savedHidden[index]
  })
  shown.forEach((object, index) => {
    object.visible = savedShown[index]
  })
  scene.background = background
  renderer.setClearColor(clearColor, clearAlpha)
  return url
}
