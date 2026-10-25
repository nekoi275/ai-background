export interface ResultViewData {
  imageUrl: string
  seed: number
  seconds: number
}

export interface ResultView {
  showStatus(text: string): void
  showResult(data: ResultViewData): void
  showError(message: string): void
}

type Section = 'status' | 'result' | 'error'

export function setupResultView(root: HTMLElement, onRegenerate: () => void): ResultView {
  root.innerHTML = `
    <div class="result">
      <div class="result__status" hidden>
        <div class="spinner"></div>
        <p class="result__status-text"></p>
      </div>

      <figure class="result__figure" hidden>
        <img class="result__image" alt="Product on the generated background" />
      </figure>

      <div class="result__bar" hidden>
        <span class="result__meta">Seed <b data-meta="seed"></b> · <span data-meta="time"></span></span>
        <div class="result__actions">
          <a class="btn-primary" data-action="download" download>Download</a>
          <button class="btn-ghost" type="button" data-action="regenerate">New variation</button>
        </div>
      </div>

      <p class="result__error" hidden></p>
    </div>
  `

  const sections: Record<Section, HTMLElement> = {
    status: root.querySelector<HTMLElement>('.result__status')!,
    result: root.querySelector<HTMLElement>('.result__figure')!,
    error: root.querySelector<HTMLElement>('.result__error')!,
  }
  const bar = root.querySelector<HTMLElement>('.result__bar')!
  const statusText = root.querySelector<HTMLElement>('.result__status-text')!
  const image = root.querySelector<HTMLImageElement>('.result__image')!
  const download = root.querySelector<HTMLAnchorElement>('[data-action="download"]')!
  const meta = (name: string) => root.querySelector<HTMLElement>(`[data-meta="${name}"]`)!

  root.querySelector<HTMLButtonElement>('[data-action="regenerate"]')!
    .addEventListener('click', () => onRegenerate())

  function showSection(active: Section): void {
    for (const [name, element] of Object.entries(sections)) {
      element.hidden = name !== active
    }
    bar.hidden = active !== 'result'
  }

  const view: ResultView = {
    showStatus(text) {
      statusText.textContent = text
      showSection('status')
    },

    showResult(data) {
      image.src = data.imageUrl
      download.href = data.imageUrl
      download.download = `ai-background-${data.seed}.jpg`
      meta('seed').textContent = String(data.seed)
      meta('time').textContent = `generated in ${data.seconds.toFixed(1)} s`
      showSection('result')
    },

    showError(message) {
      sections.error.textContent = message
      showSection('error')
    },
  }

  return view
}
