export interface GenerateParams {
  seed: number
  width: number
  height: number
  prompt: string
}

export interface GenerateResult {
  image_b64: string
  seed: number
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

const POLL_INTERVAL_MS = 4_000
const GENERATE_POLL_ATTEMPTS = 300

function wasSevered(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.message.startsWith('Expected JSON')
}

async function pollRecovery<T>(path: string, attempts: number): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
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

  generate(i: { render: Blob }, params: GenerateParams): Promise<GenerateResult> {
    const body = new FormData()
    body.set('render', i.render, 'render.png')
    body.set('params', JSON.stringify(params))
    return generateFlow(body, '/api/generate', `/api/result/${params.seed}`)
  },

  generatePhoto(i: { product: Blob }, params: GenerateParams): Promise<GenerateResult> {
    const body = new FormData()
    body.set('product', i.product, 'product.png')
    body.set('params', JSON.stringify(params))
    return generateFlow(body, '/api/generate-photo', `/api/result/${params.seed}`)
  },
}

async function generateFlow(body: FormData, submitPath: string, recoveryPath: string): Promise<GenerateResult> {
  try {
    await request<{ seed: number; queued: boolean }>(submitPath, { method: 'POST', body })
  } catch (error) {
    if (!wasSevered(error)) throw error
  }
  return pollRecovery<GenerateResult>(recoveryPath, GENERATE_POLL_ATTEMPTS)
}
