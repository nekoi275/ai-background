import { api, type Candidate, type ComposeResult } from '../api.ts'
import type { CameraAngle } from './model-scene.ts'

export interface ResultMeta {
  fileName: string
  prompt: string
  angle: CameraAngle
}

export interface ResultViewData {
  snapshot: string
  result: ComposeResult
  meta: ResultMeta
}

export interface ResultModal {
  showStatus(text: string): void
  showCandidates(candidates: Candidate[], onPick: (candidate: Candidate) => void): void
  showResult(data: ResultViewData): void
  showError(message: string): void
  close(): void
}

type Section = 'status' | 'pick' | 'result' | 'error'

export function setupResultModal(root: HTMLElement): ResultModal {
  root.innerHTML = `
    <div class="modal-overlay" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Generation result">
        <header class="modal__header">
          <h2>Result</h2>
          <button class="modal__close" type="button" aria-label="Close">&times;</button>
        </header>

        <div class="modal__status" hidden>
          <div class="spinner"></div>
          <p class="modal__status-text"></p>
        </div>

        <div class="modal__pick" hidden>
          <p class="modal__lead">Pick a background for your model</p>
          <div class="candidates"></div>
        </div>

        <div class="modal__result" hidden>
          <div class="modal__body">
            <figure class="modal__figure">
              <img class="modal__image" data-role="snapshot" alt="Camera angle" />
              <figcaption>Camera angle</figcaption>
            </figure>
            <figure class="modal__figure">
              <img class="modal__image" data-role="result" alt="Generated scene" />
              <figcaption>Generated scene</figcaption>
            </figure>
          </div>
          <dl class="modal__meta">
            <dt>Model</dt><dd data-meta="file"></dd>
            <dt>Azimuth</dt><dd data-meta="azimuth"></dd>
            <dt>Elevation</dt><dd data-meta="elevation"></dd>
            <dt>Seed</dt><dd data-meta="seed"></dd>
            <dt>Time</dt><dd data-meta="time"></dd>
            <dt>Prompt</dt><dd data-meta="prompt"></dd>
          </dl>
        </div>

        <p class="modal__error-text" hidden></p>
      </div>
    </div>
  `

  const overlay = root.querySelector<HTMLElement>('.modal-overlay')!
  const closeButton = root.querySelector<HTMLElement>('.modal__close')!
  const statusText = root.querySelector<HTMLElement>('.modal__status-text')!
  const candidatesGrid = root.querySelector<HTMLElement>('.candidates')!
  const errorText = root.querySelector<HTMLElement>('.modal__error-text')!
  const snapshotImage = root.querySelector<HTMLImageElement>('[data-role="snapshot"]')!
  const resultImage = root.querySelector<HTMLImageElement>('[data-role="result"]')!

  const sections: Record<Section, HTMLElement> = {
    status: root.querySelector<HTMLElement>('.modal__status')!,
    pick: root.querySelector<HTMLElement>('.modal__pick')!,
    result: root.querySelector<HTMLElement>('.modal__result')!,
    error: root.querySelector<HTMLElement>('.modal__error-text')!,
  }

  const meta = (name: string) => root.querySelector<HTMLElement>(`[data-meta="${name}"]`)!

  closeButton.addEventListener('click', () => view.close())
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) view.close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) view.close()
  })

  function showSection(active: Section) {
    for (const [name, element] of Object.entries(sections)) {
      element.hidden = name !== active
    }
    overlay.hidden = false
  }

  const view: ResultModal = {
    showStatus(text) {
      statusText.textContent = text
      showSection('status')
    },

    showCandidates(candidates, onPick) {
      candidatesGrid.innerHTML = ''
      for (const candidate of candidates) {
        const button = document.createElement('button')
        button.className = 'candidate'
        button.type = 'button'

        const image = document.createElement('img')
        image.src = api.assetUrl(candidate.url)
        image.alt = `Background candidate, seed ${candidate.seed}`
        button.append(image)

        button.addEventListener('click', () => onPick(candidate))
        candidatesGrid.append(button)
      }
      showSection('pick')
    },

    showResult(data) {
      snapshotImage.src = data.snapshot
      resultImage.src = api.assetUrl(data.result.url)
      meta('file').textContent = data.meta.fileName
      meta('azimuth').textContent = `${Math.round(data.meta.angle.azimuth)}°`
      meta('elevation').textContent = `${Math.round(data.meta.angle.elevation)}°`
      meta('seed').textContent = String(data.result.seed)
      meta('time').textContent = `${data.result.seconds}s`
      meta('prompt').textContent = data.meta.prompt || '— (base prompt only)'
      showSection('result')
    },

    showError(message) {
      errorText.textContent = message
      showSection('error')
    },

    close() {
      overlay.hidden = true
      snapshotImage.src = ''
      resultImage.src = ''
    },
  }

  return view
}
