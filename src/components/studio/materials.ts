import * as THREE from 'three'

export const WALL_COLOR = 0xf2e9e4
export const CEILING_COLOR = 0xc9ada7
export const FLOOR_COLOR = 0x9a8c98
export const TABLE_COLOR = 0x4a4e69

export interface RoomMaterials {
  materials: THREE.Material[]
  floor: THREE.MeshStandardMaterial
}

export function createRoomMaterials(): RoomMaterials {
  function wall() {
    return new THREE.MeshStandardMaterial({
      color: WALL_COLOR,
      roughness: 0.9,
      side: THREE.BackSide,
      toneMapped: false,
    })
  }

  const ceiling = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    roughness: 0.95,
    side: THREE.BackSide,
    toneMapped: false,
  })
  const floor = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.85,
    side: THREE.BackSide,
    toneMapped: false,
  })
  return {
    materials: [wall(), wall(), ceiling, floor, wall(), wall()],
    floor,
  }
}

export function createTableMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: TABLE_COLOR,
    roughness: 0.8,
    toneMapped: false,
  })
}

export function setSurfaceGlossiness(
  floor: THREE.MeshStandardMaterial,
  table: THREE.MeshStandardMaterial,
  glossy: boolean,
): void {
  floor.roughness = glossy ? 0.25 : 0.85
  table.roughness = glossy ? 0.3 : 0.8
}

export interface DepthShaderContext {
  uniforms: {
    uNear: { value: number }
    uFar: { value: number }
  }
  material: THREE.ShaderMaterial
}

export function createDepthMaterial(): DepthShaderContext {
  const uniforms = {
    uNear: { value: 0.1 },
    uFar: { value: 10 },
  }

  const vertexShader = `
    varying float vDistance;
    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vDistance = length(viewPosition.xyz);
      gl_Position = projectionMatrix * viewPosition;
    }`

  const fragmentShader = `
    uniform float uNear;
    uniform float uFar;
    varying float vDistance;
    float bayer2(vec2 a) {
      a = floor(a);
      return fract(a.x / 2.0 + a.y * a.y * 0.75);
    }
    float bayer8(vec2 a) {
      return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a);
    }
    void main() {
      float closeness = clamp((uFar - vDistance) / (uFar - uNear), 0.0, 1.0);
      closeness += (bayer8(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(vec3(closeness), 1.0);
    }`

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader,
    fragmentShader,
  })

  return { uniforms, material }
}
