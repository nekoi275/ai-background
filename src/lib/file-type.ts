export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx'

export type ProductFileKind =
  | { kind: 'image' }
  | { kind: 'model'; format: ModelFormat }

const MODEL_EXTENSIONS: Record<string, ModelFormat> = {
  glb: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  fbx: 'fbx',
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('')
}

async function decodesAsImage(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
    return true
  } catch {
    return false
  }
}

export async function detectProductFile(file: File): Promise<ProductFileKind> {
  const ext = extensionOf(file.name)
  if (MODEL_EXTENSIONS[ext]) return { kind: 'model', format: MODEL_EXTENSIONS[ext] }
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) {
    return { kind: 'image' }
  }

  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  if (ascii(head.subarray(0, 4)) === 'glTF') return { kind: 'model', format: 'glb' }
  if (ascii(head).startsWith('Kaydara FBX Binary')) return { kind: 'model', format: 'fbx' }
  if (await decodesAsImage(file)) return { kind: 'image' }

  const text = ascii(new Uint8Array(await file.slice(0, 4096).arrayBuffer()))
  if (/^\s*(v|vn|vt|o|g|s|mtllib|usemtl)\s/m.test(text)) {
    return { kind: 'model', format: 'obj' }
  }
  if (text.trimStart().startsWith('{')) return { kind: 'model', format: 'gltf' }

  throw new Error(
    `Unsupported file${ext ? ` “.${ext}”` : ''} — drop a photo (JPG/PNG/WebP) or a 3D model (GLB/GLTF/OBJ/FBX).`,
  )
}
