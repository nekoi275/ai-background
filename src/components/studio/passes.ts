import * as THREE from 'three'
import type { RoomConfig } from './types.ts'

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

export function farthestCornerDistance(room: RoomConfig, origin: THREE.Vector3): number {
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

export function captureDepthPass(
  context: RenderContext,
  depthMaterial: THREE.Material,
  uFarRef: { value: number },
  room: RoomConfig,
): string {
  const { renderer, scene, camera, canvas, productRoot } = context
  const swaps = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  uFarRef.value = farthestCornerDistance(room, camera.position) * 1.05
  const dims = calculateCaptureDims(camera)
  productRoot.visible = false
  try {
    return renderCapture(
      renderer,
      scene,
      camera,
      canvas,
      dims.width,
      dims.height,
      () => {
        scene.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          swaps.set(mesh, mesh.material)
          mesh.material = depthMaterial
        })
        scene.background = null
      },
      () => {
        for (const [mesh, material] of swaps) mesh.material = material
      },
    )
  } finally {
    productRoot.visible = true
  }
}

export function capturePlatePass(context: RenderContext, tableVisible: boolean): string {
  const { renderer, scene, camera, canvas } = context
  const dims = calculateCaptureDims(camera)
  const pass = createProductOnlyPass(context, tableVisible)
  return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height, pass.setup, pass.teardown)
}

export function captureReflectionPass(context: RenderContext, tableVisible: boolean): string | null {
  const { renderer, scene, camera, canvas, productRoot } = context
  try {
    const dims = calculateCaptureDims(camera)
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
    const pass = createProductOnlyPass(context, tableVisible)
    try {
      return renderCapture(renderer, scene, camera, canvas, dims.width, dims.height, pass.setup, pass.teardown)
    } finally {
      productRoot.scale.y = 1
      productRoot.updateMatrixWorld()
      for (const [node, culled] of cullSaves) node.frustumCulled = culled
      for (const { material, side } of sideSaves) material.side = side
    }
  } catch {
    return null
  }
}

export function captureShadowPass(
  context: RenderContext,
  tableVisible: boolean,
  hasModelProduct: boolean,
): string | null {
  if (!hasModelProduct) return null
  const { renderer, scene, camera, canvas, productRoot } = context
  try {
    const bbox = new THREE.Box3().setFromObject(productRoot)
    const size = bbox.getSize(new THREE.Vector3())
    const half = Math.max(size.x, size.z) * 0.8 + 1
    const dims = calculateCaptureDims(camera)

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

    const pass = createProductOnlyPass(context, tableVisible)
    try {
      return renderCapture(
        renderer,
        scene,
        camera,
        canvas,
        dims.width,
        dims.height,
        () => {
          renderer.shadowMap.needsUpdate = true
          pass.setup()
        },
        pass.teardown,
      )
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
}
