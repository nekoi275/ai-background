import './styles/index.css'
import { api } from './api.ts'
import type { GenerateResult } from './api.ts'
import { detectProductFile } from './lib/file-type.ts'
import { preparePhotoCutout, aiPhotoCutout } from './lib/image.ts'
import { dataUrlToBlob } from './lib/encode.ts'
import { setupDropzone } from './components/dropzone.ts'
import { loadModelFile } from './components/model-loader.ts'
import { createStudioScene } from './components/studio/index.ts'
import type { ProductData, RoomConfig, TableConfig, TableShape } from './components/studio/index.ts'
import { setupResultView } from './components/result-view.ts'

type StepId = 1 | 2 | 3 | 4
const LAST_STEP: StepId = 4

interface LoadedProduct {
  kind: 'photo' | 'model'
  name: string
  details: string
  data: ProductData
  previewUrl: string | null
  sourcePng: Blob | null
  cutoutPng: Blob | null
  canUpgradeCutout: boolean
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const stepSections: Record<StepId, HTMLElement> = {
  1: $('step-1'),
  2: $('step-2'),
  3: $('step-3'),
  4: $('step-4'),
}
const stepperButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.stepper__item'),
).sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step))

const backButton = $<HTMLButtonElement>('back')
const nextButton = $<HTMLButtonElement>('next')
const restartButton = $<HTMLButtonElement>('restart')

const productCard = $('product-card')
const productBadge = $('product-badge')
const productName = $('product-name')
const productDetails = $('product-details')
const productReplace = $('product-replace')
const cutoutTip = $('cutout-tip')
const cutoutAiButton = $<HTMLButtonElement>('cutout-ai')
const cutoutError = $('cutout-error')

const photoControls = $('photo-controls')
const modelInfo = $('model-info')
const shotPreview = $<HTMLImageElement>('shot-preview')
const shotFigure = $('shot-figure')
const promptLead = $('prompt-lead')

const promptInput = $<HTMLTextAreaElement>('prompt')

const roomInputs = {
  width: $<HTMLInputElement>('room-width'),
  height: $<HTMLInputElement>('room-height'),
  depth: $<HTMLInputElement>('room-depth'),
}
const tableInputs = {
  visible: $<HTMLInputElement>('table-visible'),
  shape: $<HTMLSelectElement>('table-shape'),
  width: $<HTMLInputElement>('table-width'),
  depth: $<HTMLInputElement>('table-depth'),
  height: $<HTMLInputElement>('table-height'),
  x: $<HTMLInputElement>('table-x'),
  z: $<HTMLInputElement>('table-z'),
}
const photoHeightInput = $<HTMLInputElement>('photo-height')

const scene = createStudioScene($('scene'))
const dropzone = setupDropzone($('dropzone'), (file) => void handleProductFile(file))
const resultView = setupResultView($('result-root'), () => void generate())

let product: LoadedProduct | null = null
let step: StepId = 1
let resultReached = false
let busy = false
let generating = false

for (const button of stepperButtons) {
  button.addEventListener('click', () => {
    const target = Number(button.dataset.step) as StepId
    if (stepperReachable(target)) setStep(target)
  })
}
backButton.addEventListener('click', () => setStep(previousStep()))
nextButton.addEventListener('click', () => {
  if (step === 3) void generate()
  else setStep(nextStep())
})
restartButton.addEventListener('click', () => {
  if (generating) return
  resultReached = false
  setStep(1)
})

function stepperReachable(target: StepId): boolean {
  if (target === step) return true
  if (generating || step === LAST_STEP) return false
  if (target === 1) return true
  if (target === 2) return product?.kind === 'model'
  if (target === LAST_STEP) return resultReached
  return product !== null
}

function nextStep(): StepId {
  if (step === 1 && product?.kind === 'photo') return 3
  return Math.min(LAST_STEP, step + 1) as StepId
}

function previousStep(): StepId {
  if (step === 3 && product?.kind === 'photo') return 1
  return Math.max(1, step - 1) as StepId
}

function setStep(next: StepId): void {
  step = next
  for (const [id, section] of Object.entries(stepSections)) {
    section.hidden = Number(id) !== next
  }
  if (next === 3) {
    promptLead.textContent =
      product?.kind === 'photo'
        ? 'The product is drawn straight into the scene you describe — no 3D placement is involved.'
        : 'The scene follows your camera exactly; the prompt decides what the space around the product is.'
    shotFigure.hidden = product?.kind === 'photo'
    if (product?.kind !== 'photo') shotPreview.src = scene.captureView()
  }
  updateNav()
}

function updateNav(): void {
  stepperButtons.forEach((button, index) => {
    const target = (index + 1) as StepId
    button.classList.toggle('stepper__item--active', target === step)
    button.classList.toggle('stepper__item--done', target < step)
    button.disabled = !stepperReachable(target)
  })
  backButton.hidden = step === LAST_STEP
  backButton.disabled = step === 1 || generating
  restartButton.hidden = step !== LAST_STEP || generating
  nextButton.hidden = step === LAST_STEP
  nextButton.textContent = step === 3 ? 'Generate' : 'Next'
  nextButton.disabled =
    busy || generating || (step === 1 && product === null) || (step === 2 && !canLeaveScene())
}

function canLeaveScene(): boolean {
  return product !== null
}

async function handleProductFile(file: File): Promise<void> {
  if (busy) return
  busy = true
  updateNav()
  const previous = product
  try {
    const detected = await detectProductFile(file)
    if (detected.kind === 'image') {
      dropzone.showStatus('Removing the background…')
      const prepared = await preparePhotoCutout(file, api.cutout)
      product = {
        kind: 'photo',
        name: file.name,
        details: `Photo · ${prepared.cutout.width} × ${prepared.cutout.height} px`,
        data: { kind: 'photo', url: prepared.cutout.url, aspect: prepared.cutout.aspect },
        previewUrl: prepared.cutout.url,
        sourcePng: prepared.sourcePng,
        cutoutPng: prepared.cutout.png,
        canUpgradeCutout: prepared.method === 'chromakey',
      }
    } else {
      dropzone.showStatus('Loading the 3D model…')
      const model = await loadModelFile(file, detected.format)
      product = {
        kind: 'model',
        name: file.name,
        details: `3D model · ${formatSize(model.size)}`,
        data: { kind: 'model', object: model.object },
        previewUrl: null,
        sourcePng: null,
        cutoutPng: null,
        canUpgradeCutout: false,
      }
    }
    scene.setProduct(product.data)
    dropzone.setFilled(product.name, product.previewUrl)
    if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl)
    showProductCard()
    applyScene()
    updateNav()
  } catch (error) {
    dropzone.showError(error instanceof Error ? error.message : String(error))
  } finally {
    busy = false
    updateNav()
  }
}

async function upgradePhotoCutout(): Promise<void> {
  if (!product || product.kind !== 'photo' || !product.sourcePng || !product.canUpgradeCutout || busy) return
  busy = true
  cutoutAiButton.disabled = true
  cutoutError.hidden = true
  cutoutAiButton.textContent = 'Removing…'
  updateNav()
  try {
    const cutout = await aiPhotoCutout(product.sourcePng, api.cutout)
    if (product.previewUrl) URL.revokeObjectURL(product.previewUrl)
    product.data = { kind: 'photo', url: cutout.url, aspect: cutout.aspect }
    product.previewUrl = cutout.url
    product.cutoutPng = cutout.png
    product.details = `Photo · ${cutout.width} × ${cutout.height} px`
    product.canUpgradeCutout = false
    scene.setProduct(product.data)
    dropzone.setFilled(product.name, product.previewUrl)
    showProductCard()
    updateNav()
  } catch (error) {
    cutoutError.textContent = error instanceof Error ? error.message : String(error)
    cutoutError.hidden = false
  } finally {
    busy = false
    cutoutAiButton.disabled = false
    cutoutAiButton.textContent = 'Remove background with AI'
    updateNav()
  }
}

cutoutAiButton.addEventListener('click', () => void upgradePhotoCutout())

function showProductCard(): void {
  productCard.hidden = !product
  if (!product) return
  productBadge.textContent = product.kind === 'photo' ? 'Photo' : '3D model'
  productBadge.classList.toggle('product-card__badge--model', product.kind === 'model')
  productName.textContent = product.name
  productDetails.textContent = product.details
  photoControls.hidden = product.kind !== 'photo'
  modelInfo.hidden = product.kind !== 'model'
  if (product.kind === 'model') modelInfo.textContent = product.details
  cutoutTip.hidden = !(product.kind === 'photo' && product.canUpgradeCutout)
  cutoutError.hidden = true
}

productReplace.addEventListener('click', () => document.getElementById('dropzone')!.click())

function currentRoom(): RoomConfig {
  return {
    width: Number(roomInputs.width.value),
    height: Number(roomInputs.height.value),
    depth: Number(roomInputs.depth.value),
  }
}

function currentTable(): TableConfig {
  return {
    visible: tableInputs.visible.checked,
    shape: tableInputs.shape.value as TableShape,
    width: Number(tableInputs.width.value),
    depth: Number(tableInputs.depth.value),
    height: Number(tableInputs.height.value),
    x: Number(tableInputs.x.value),
    z: Number(tableInputs.z.value),
  }
}

function clampTableToRoom(room: RoomConfig, table: TableConfig): TableConfig {
  const snap = (value: number, limit: number) => Math.round(Math.min(value, limit) * 20) / 20
  table.width = snap(table.width, room.width)
  table.depth = snap(table.depth, room.depth)
  table.height = snap(table.height, room.height)
  const halfX = Math.max(0, room.width / 2 - table.width / 2)
  const halfZ = Math.max(0, room.depth / 2 - table.depth / 2)
  table.x = Math.min(halfX, Math.max(-halfX, table.x))
  table.z = Math.min(halfZ, Math.max(-halfZ, table.z))
  return table
}

function applyScene(): void {
  const room = currentRoom()
  const table = clampTableToRoom(room, currentTable())
  syncControlOutputs()
  tableInputs.x.min = String(-room.width / 2)
  tableInputs.x.max = String(room.width / 2)
  tableInputs.z.min = String(-room.depth / 2)
  tableInputs.z.max = String(room.depth / 2)
  tableInputs.width.value = String(table.width)
  tableInputs.depth.value = String(table.depth)
  tableInputs.height.value = String(table.height)
  tableInputs.x.value = String(table.x)
  tableInputs.z.value = String(table.z)
  $('table-controls').classList.toggle('controls__group--disabled', !table.visible)
  scene.setRoom(room)
  scene.setTable(table)
  if (product?.kind === 'photo') scene.setPhotoHeight(Number(photoHeightInput.value) / 100)
  updateSliderArrows()
}

function syncControlOutputs(): void {
  setOut('room-width', `${Number(roomInputs.width.value).toFixed(1)} m`)
  setOut('room-height', `${Number(roomInputs.height.value).toFixed(1)} m`)
  setOut('room-depth', `${Number(roomInputs.depth.value).toFixed(1)} m`)
  setOut('table-width', `${Number(tableInputs.width.value).toFixed(2)} m`)
  setOut('table-depth', `${Number(tableInputs.depth.value).toFixed(2)} m`)
  setOut('table-height', `${Number(tableInputs.height.value).toFixed(2)} m`)
  setOut('table-x', `${Number(tableInputs.x.value).toFixed(2)} m`)
  setOut('table-z', `${Number(tableInputs.z.value).toFixed(2)} m`)
  setOut('photo-height', `${photoHeightInput.value}%`)
}

function stepSlider(input: HTMLInputElement, dir: number, stepDelta = 1): void {
  const min = input.min !== '' ? Number(input.min) : -Infinity
  const max = input.max !== '' ? Number(input.max) : Infinity
  const current = Number(input.value)
  const next = Math.min(max, Math.max(min, current + dir * stepDelta))
  const precision = input.step.includes('.') ? input.step.split('.')[1].length : 0
  const rounded = Number(next.toFixed(precision))
  if (rounded !== current) {
    input.value = String(rounded)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function updateSliderArrows(): void {
  const sliders = document.querySelectorAll<HTMLElement>('.control__slider')
  for (const slider of sliders) {
    const input = slider.querySelector<HTMLInputElement>('input[type="range"]')
    if (!input) continue
    const prevBtn = slider.querySelector<HTMLButtonElement>('.control__arrow--prev')
    const nextBtn = slider.querySelector<HTMLButtonElement>('.control__arrow--next')
    const val = Number(input.value)
    const min = input.min !== '' ? Number(input.min) : -Infinity
    const max = input.max !== '' ? Number(input.max) : Infinity
    if (prevBtn) prevBtn.disabled = val <= min + 1e-6
    if (nextBtn) nextBtn.disabled = val >= max - 1e-6
  }
}

function setupSliderArrows(): void {
  const arrows = document.querySelectorAll<HTMLButtonElement>('.control__arrow')
  for (const arrow of arrows) {
    arrow.addEventListener('click', (e) => {
      e.preventDefault()
      const slider = arrow.closest('.control__slider')
      const input = slider?.querySelector<HTMLInputElement>('input[type="range"]')
      if (!input || input.disabled) return
      const dir = Number(arrow.dataset.stepDir) || 0
      if (!dir) return
      stepSlider(input, dir, 1)
    })
  }
}

function setOut(id: string, text: string): void {
  const out = document.querySelector<HTMLElement>(`[data-out="${id}"]`)
  if (out) out.textContent = text
}

for (const input of Object.values(roomInputs)) {
  input.addEventListener('input', applyScene)
}
for (const input of Object.values(tableInputs)) {
  input.addEventListener('input', applyScene)
}
photoHeightInput.addEventListener('input', applyScene)
setupSliderArrows()

function formatSize(size: { x: number; y: number; z: number }): string {
  return `${size.x.toFixed(2)} × ${size.z.toFixed(2)} × ${size.y.toFixed(2)} m (W × D × H)`
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
}

const PHOTO_SIZE = { width: 1024, height: 1024 }

async function generate(): Promise<void> {
  if (!product || generating) return
  generating = true
  updateNav()
  setStep(4)
  const seed = randomSeed()
  const startedAt = performance.now()
  try {
    let result: GenerateResult
    if (product.kind === 'photo') {
      resultView.showStatus('Generating the photo…')
      result = await api.generatePhoto(
        { product: product.cutoutPng! },
        { seed, width: PHOTO_SIZE.width, height: PHOTO_SIZE.height, prompt: promptInput.value.trim() },
      )
    } else {
      resultView.showStatus('Preparing the shot…')
      const frame = scene.captureSize()
      const layout = dataUrlToBlob(scene.captureView())
      const plate = dataUrlToBlob(scene.capturePlate())
      const table = currentTable()

      resultView.showStatus('Generating the photo…')
      result = await api.generate(
        { layout, plate, product: product.cutoutPng },
        {
          seed, width: frame.width, height: frame.height,
          prompt: promptInput.value.trim(),
          table_visible: table.visible, table_shape: table.shape,
        },
      )
    }
    resultReached = true
    resultView.showResult({
      imageUrl: `data:image/jpeg;base64,${result.image_b64}`,
      seed: result.seed,
      seconds: (performance.now() - startedAt) / 1000,
    })
  } catch (error) {
    resultView.showError(describeError(error))
  } finally {
    generating = false
    updateNav()
  }
}

function describeError(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Could not reach the generation backend through the API proxy. In dev, check MODAL_API_URL/API_TOKEN in .env.local and restart the dev server.'
  }
  return error instanceof Error ? error.message : String(error)
}

showProductCard()
applyScene()
setStep(1)
