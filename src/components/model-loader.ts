import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { ModelFormat } from '../lib/file-type.ts'

export interface LoadedModel {
  object: THREE.Group
  size: THREE.Vector3
}

async function loadSource(file: File, format: ModelFormat): Promise<THREE.Object3D> {
  switch (format) {
    case 'glb':
    case 'gltf': {
      const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '')
      return gltf.scene
    }
    case 'obj':
      return new OBJLoader().parse(await file.text())
    case 'fbx':
      return new FBXLoader().parse(await file.arrayBuffer(), '')
  }
}

export async function loadModelFile(file: File, format: ModelFormat): Promise<LoadedModel> {
  let source: THREE.Object3D
  try {
    source = await loadSource(file, format)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not parse the 3D model: ${reason}`)
  }

  const box = new THREE.Box3().setFromObject(source)
  const size = box.getSize(new THREE.Vector3())
  if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z) || size.lengthSq() === 0) {
    throw new Error('The 3D model contains no measurable geometry')
  }

  const center = box.getCenter(new THREE.Vector3())
  source.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))

  const wrapper = new THREE.Group()
  wrapper.name = 'model-product'
  wrapper.add(source)
  return { object: wrapper, size }
}
