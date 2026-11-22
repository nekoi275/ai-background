import * as THREE from 'three'

export const CAPTURE_SIZE = 1024
export const CAPTURE_MIN_SIDE = 512

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

function applyGrain(canvas: HTMLCanvasElement, amount: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

export function renderCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): string {
  const pixelRatio = renderer.getPixelRatio()
  const size = renderer.getSize(new THREE.Vector2())
  const aspect = camera.aspect

  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  applyGrain(out, 12)

  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(size.width, size.height, false)
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  return out.toDataURL('image/png')
}
