import * as THREE from 'three'

export const WALL_COLOR = 0xede9e1
export const CEILING_COLOR = 0xf4f1eb
export const FLOOR_COLOR = 0xdcd5c9
export const TABLE_COLOR = 0xe3d8c6
export const BACKDROP_COLOR = 0xf0eeeb

export function createRoomMaterials(): THREE.Material[] {
  function wall() {
    return new THREE.MeshStandardMaterial({
      color: WALL_COLOR,
      roughness: 0.9,
      side: THREE.BackSide,
    })
  }

  return [
    wall(),
    wall(),
    new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85 }),
    wall(),
    wall(),
  ]
}

export function createTableMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: TABLE_COLOR,
    roughness: 0.8,
  })
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
    void main() {
      float closeness = clamp((uFar - vDistance) / (uFar - uNear), 0.0, 1.0);
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
