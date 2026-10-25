export interface DropzoneView {
  showStatus(text: string): void
  setFilled(name: string, previewUrl: string | null): void
  showError(message: string): void
}

export function setupDropzone(root: HTMLElement, onFile: (file: File) => void): DropzoneView {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
  const icon = root.querySelector<HTMLElement>('.dropzone__icon')!
  const text = root.querySelector<HTMLElement>('.dropzone__text')!
  const hint = root.querySelector<HTMLElement>('.dropzone__hint')!
  const error = root.querySelector<HTMLElement>('.dropzone__error')!
  const preview = root.querySelector<HTMLImageElement>('.dropzone__preview')!

  const initialText = text.innerHTML
  const initialHint = hint.innerHTML

  root.addEventListener('click', () => input.click())

  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.value = ''
    if (file) onFile(file)
  })

  root.addEventListener('dragover', (event) => {
    event.preventDefault()
    error.hidden = true
    root.classList.add('dropzone--over')
  })

  root.addEventListener('dragleave', () => root.classList.remove('dropzone--over'))

  root.addEventListener('drop', (event) => {
    event.preventDefault()
    root.classList.remove('dropzone--over')
    const file = event.dataTransfer?.files?.[0]
    if (file) onFile(file)
  })

  function reset() {
    preview.hidden = true
    preview.src = ''
    icon.hidden = false
    root.classList.remove('dropzone--filled')
    text.innerHTML = initialText
    hint.innerHTML = initialHint
    error.hidden = true
  }

  return {
    showStatus(message) {
      reset()
      text.textContent = message
      root.classList.add('dropzone--busy')
    },

    setFilled(name, previewUrl) {
      reset()
      root.classList.remove('dropzone--busy')
      root.classList.add('dropzone--filled')
      text.textContent = name
      hint.textContent = 'Click to replace'
      if (previewUrl) {
        preview.src = previewUrl
        preview.hidden = false
        icon.hidden = true
      }
    },

    showError(message) {
      reset()
      root.classList.remove('dropzone--busy')
      error.textContent = message
      error.hidden = false
    },
  }
}
