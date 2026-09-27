const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export interface ComposeParams {
  prompt: string
  negative_prompt: string
  seed?: number
}

export interface ComposeResult {
  url: string
  seed: number
  seconds: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) {
    throw new Error(
      'VITE_API_URL is not set: copy .env.example to .env.local, put the Modal app URL there and restart the dev server.',
    )
  }
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Backend responded with ${response.status}: ${details.slice(0, 200)}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from the backend but received ${contentType || 'no content type'} — check that VITE_API_URL points at the Modal app URL.`,
    )
  }
  return (await response.json()) as T
}

function post<T>(path: string, body: FormData): Promise<T> {
  return request(path, { method: 'POST', body })
}

export const api = {
  assetUrl(path: string): string {
    return path.startsWith('/') ? `${BASE}${path}` : path
  },

  compose(plate: Blob, depth: Blob, shadow: Blob, params: ComposeParams): Promise<ComposeResult> {
    const body = new FormData()
    body.set('plate', plate, 'plate.png')
    body.set('depth', depth, 'depth.png')
    body.set('shadow', shadow, 'shadow.png')
    body.set('params', JSON.stringify(params))
    return post('/api/compose', body)
  },
}
