import './style.css'
import { api, type Candidate } from './api.ts'
import { setupDropzone } from './components/dropzone.ts'
import { createModelScene } from './components/model-scene.ts'
import { setupResultModal } from './components/result-modal.ts'

const CANDIDATES_COUNT = 4

const dropzone = setupDropzone(document.getElementById('dropzone')!, handleModel)
const modelScene = createModelScene(document.getElementById('scene')!)
const resultModal = setupResultModal(document.getElementById('modal-root')!)

const promptInput = document.getElementById('prompt') as HTMLTextAreaElement
const heightInput = document.getElementById('object-height') as HTMLInputElement
const generateButton = document.getElementById('generate') as HTMLButtonElement

let modelName: string | null = null

heightInput.addEventListener('input', updateGenerateState)
generateButton.addEventListener('click', () => void handleGenerate())

function objectHeightMm(): number {
  return Number.parseFloat(heightInput.value)
}

function updateGenerateState() {
  generateButton.disabled =
    modelName === null || !Number.isFinite(objectHeightMm()) || objectHeightMm() <= 0
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
  resultModal.showStatus('Generating backgrounds…')
  try {
    const candidates = await api.genBackgrounds(prompt, CANDIDATES_COUNT)
    if (candidates.length === 0) throw new Error('The backend returned no background candidates')
    resultModal.showCandidates(candidates, (candidate) => void composeScene(candidate, prompt))
  } catch (error) {
    resultModal.showError(describeError(error))
  }
}

async function composeScene(candidate: Candidate, prompt: string) {
  resultModal.showStatus('Composing the scene — the first request can take a few minutes…')
  try {
    const templateId = crypto.randomUUID()
    await api.makeTemplate(candidate.url.replace(/^\/asset\//, ''), templateId)

    const plate = await (await fetch(modelScene.capturePlate())).blob()
    const result = await api.compose(plate, {
      template_id: templateId,
      height_mm: objectHeightMm(),
      prompt,
    })

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
