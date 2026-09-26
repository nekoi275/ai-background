import './style.css'
import { setupDropzone } from './components/dropzone.ts'
import { createModelScene } from './components/model-scene.ts'
import { setupResultModal } from './components/result-modal.ts'

const dropzone = setupDropzone(document.getElementById('dropzone')!, handleModel)
const modelScene = createModelScene(document.getElementById('scene')!)
const resultModal = setupResultModal(document.getElementById('modal-root')!)

const promptInput = document.getElementById('prompt') as HTMLTextAreaElement
const generateButton = document.getElementById('generate') as HTMLButtonElement

let modelName: string | null = null

promptInput.addEventListener('input', updateGenerateState)
generateButton.addEventListener('click', handleGenerate)

function updateGenerateState() {
  generateButton.disabled = modelName === null || promptInput.value.trim() === ''
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

function handleGenerate() {
  resultModal.open({
    snapshot: modelScene.captureView(),
    fileName: modelName!,
    prompt: promptInput.value.trim(),
    angle: modelScene.getCameraAngle(),
  })
}
