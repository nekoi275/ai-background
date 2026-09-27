import './style.css'
import { api } from './api.ts'
import { setupDropzone } from './components/dropzone.ts'
import { createModelScene } from './components/model-scene.ts'
import { setupResultModal } from './components/result-modal.ts'

const dropzone = setupDropzone(document.getElementById('dropzone')!, handleModel)
const modelScene = createModelScene(document.getElementById('scene')!)
const resultModal = setupResultModal(document.getElementById('modal-root')!)

const promptInput = document.getElementById('prompt') as HTMLTextAreaElement
const generateButton = document.getElementById('generate') as HTMLButtonElement

let modelName: string | null = null

generateButton.addEventListener('click', () => void handleGenerate())

function updateGenerateState() {
  generateButton.disabled = modelName === null
}

async function handleModel(file: File) {
  generateButton.disabled = true
  const loaded = await modelScene.loadModel(file)
  if (loaded) {
    modelName = file.name
    dropzone.setFile(file.name)
  } else {
    dropzone.showError('Failed to load the model, try another file')
  }
  updateGenerateState()
}

async function handleGenerate() {
  const prompt = promptInput.value.trim()
  resultModal.showStatus('Generating the scene from your camera view…')
  try {
    const plate = await (await fetch(modelScene.capturePlate())).blob()
    const depth = await (await fetch(modelScene.captureDepth())).blob()
    const result = await api.compose(plate, depth, { prompt })

    resultModal.showResult({
      snapshot: modelScene.captureView(),
      result,
      meta: { fileName: modelName!, prompt, angle: modelScene.getCameraAngle() },
    })
  } catch (error) {
    resultModal.showError(describeError(error))
  }
}

function describeError(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Could not reach the generation backend. Check that it is running and VITE_API_URL is set.'
  }
  return error instanceof Error ? error.message : String(error)
}
