const MODEL_EXTENSIONS = /\.(glb|gltf)$/i

export interface Dropzone {
  setFile(name: string): void
  showError(message: string): void
}


export function setupDropzone(root: HTMLElement, onModel: (file: File) => void): Dropzone {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
  const text = root.querySelector<HTMLElement>('.dropzone__text')!
  const hint = root.querySelector<HTMLElement>('.dropzone__hint')!
  const error = root.querySelector<HTMLElement>('.dropzone__error')!

  root.addEventListener('click', () => input.click())

  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.value = ''
    if (file) handleFile(file)
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
    if (file) handleFile(file)
  })

  function handleFile(file: File) {
    if (!MODEL_EXTENSIONS.test(file.name)) {
      showError('Only .glb and .gltf files are supported')
      return
    }
    onModel(file)
  }

  function showError(message: string) {
    error.textContent = message
    error.hidden = false
  }

  return {
    setFile(name) {
      text.textContent = name
      hint.textContent = 'Click to replace'
      error.hidden = true
    },
    showError,
  }
}
