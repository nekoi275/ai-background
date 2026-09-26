import type { CameraAngle } from './model-scene.ts'

export interface ResultData {
  snapshot: string
  fileName: string
  prompt: string
  angle: CameraAngle
}

export interface ResultModal {
  open(data: ResultData): void
  close(): void
}

export function setupResultModal(root: HTMLElement): ResultModal {
  root.innerHTML = `
    <div class="modal-overlay" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Generation result">
        <header class="modal__header">
          <h2>Result</h2>
          <button class="modal__close" type="button" aria-label="Close">&times;</button>
        </header>
        <div class="modal__body">
          <figure class="modal__figure">
            <img class="modal__image" alt="Camera angle" />
            <figcaption>Camera angle</figcaption>
          </figure>
          <figure class="modal__figure">
            <div class="modal__placeholder">
              The generated image will appear here<br />once the backend is connected
            </div>
            <figcaption>Generated background</figcaption>
          </figure>
        </div>
        <dl class="modal__meta">
          <dt>Model</dt><dd data-meta="file"></dd>
          <dt>Azimuth</dt><dd data-meta="azimuth"></dd>
          <dt>Elevation</dt><dd data-meta="elevation"></dd>
          <dt>Prompt</dt><dd data-meta="prompt"></dd>
        </dl>
      </div>
    </div>
  `

  const overlay = root.querySelector<HTMLElement>('.modal-overlay')!
  const image = root.querySelector<HTMLImageElement>('.modal__image')!
  const close = root.querySelector<HTMLElement>('.modal__close')!

  const meta = (name: string) => root.querySelector<HTMLElement>(`[data-meta="${name}"]`)!

  close.addEventListener('click', () => api.close())
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) api.close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) api.close()
  })

  const api: ResultModal = {
    open(data) {
      image.src = data.snapshot
      meta('file').textContent = data.fileName
      meta('azimuth').textContent = `${Math.round(data.angle.azimuth)}°`
      meta('elevation').textContent = `${Math.round(data.angle.elevation)}°`
      meta('prompt').textContent = data.prompt
      overlay.hidden = false
    },
    close() {
      overlay.hidden = true
      image.src = ''
    },
  }

  return api
}
