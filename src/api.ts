export interface SceneParams {
  seed: number
  width: number
  height: number
  prompt: string
  negative_prompt: string
}

export interface SceneResult {
  scene_b64: string
  depth_b64: string
  seed: number
  width: number
  height: number
  seconds: number
}

export interface ComposeResult {
  image_b64: string
  seed: number
  seconds: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Backend responded with ${response.status}: ${details.slice(0, 200)}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from the backend but received ${contentType || 'no content type'} — the API proxy may be missing.`,
    )
  }
  return (await response.json()) as T
}

const PROXY_LIMIT_MS = 140_000
const POLL_INTERVAL_MS = 4_000
const POLL_ATTEMPTS = 90

async function withRecovery<T>(path: string, body: FormData, recoveryPath: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROXY_LIMIT_MS)
  try {
    return await request<T>(path, { method: 'POST', body, signal: controller.signal })
  } catch (error) {
    if (!wasSevered(error)) throw error
    return pollRecovery<T>(recoveryPath)
  } finally {
    clearTimeout(timeout)
  }
}

function wasSevered(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.message.startsWith('Expected JSON')
}

async function pollRecovery<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    try {
      return await request<T>(path)
    } catch (error) {
      const missing = error instanceof Error && error.message.includes('responded with 404')
      if (!missing) throw error
    }
  }
  throw new Error('The backend never finished the generation — check the backend logs.')
}

export const api = {
  async cutout(png: Blob): Promise<Blob> {
    const body = new FormData()
    body.set('image', png, 'product.png')
    const response = await fetch('/api/cutout', { method: 'POST', body })
    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new Error(`Cutout failed (${response.status}): ${details.slice(0, 200)}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('image/png')) {
      throw new Error(`Expected a PNG from /api/cutout but received ${contentType || 'no content type'}.`)
    }
    return response.blob()
  },

  scene(params: SceneParams, depth: Blob): Promise<SceneResult> {
    const body = new FormData()
    body.set('params', JSON.stringify(params))
    body.set('depth', depth, 'depth.png')
    return withRecovery('/api/scene', body, `/api/scene-result/${params.seed}`)
  },

  compose(
    plate: Blob,
    scene: Blob,
    depth: Blob,
    params: { seed: number },
    reflection: Blob | null = null,
    shadow: Blob | null = null,
  ): Promise<ComposeResult> {
    const body = new FormData()
    body.set('plate', plate, 'plate.png')
    body.set('scene', scene, 'scene.jpg')
    body.set('depth', depth, 'depth.png')
    if (reflection) body.set('reflection', reflection, 'reflection.png')
    if (shadow) body.set('shadow', shadow, 'shadow.png')
    body.set('params', JSON.stringify(params))
    return request('/api/compose', { method: 'POST', body })
  },
}
