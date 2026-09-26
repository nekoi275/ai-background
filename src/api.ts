const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export interface Candidate {
  url: string
  seed: number
}

export interface ComposeParams {
  template_id: string
  height_mm: number
  prompt: string
  seed?: number
}

export interface ComposeResult {
  url: string
  seed: number
  seconds: number
}

async function post<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', body })
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Backend responded with ${response.status}: ${details.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

export const api = {
  assetUrl(path: string): string {
    return `${BASE}${path}`
  },

  genBackgrounds(prompt: string, count = 4): Promise<Candidate[]> {
    const body = new FormData()
    body.set('n', String(count))
    body.set('prompt', prompt)
    return post('/api/gen-backgrounds', body)
  },

  makeTemplate(file: string, templateId: string): Promise<unknown> {
    const body = new FormData()
    body.set('file', file)
    body.set('tid', templateId)
    return post('/api/make-template', body)
  },

  compose(plate: Blob, params: ComposeParams): Promise<ComposeResult> {
    const body = new FormData()
    body.set('plate', plate, 'plate.png')
    body.set('params', JSON.stringify(params))
    return post('/api/compose', body)
  },
}
