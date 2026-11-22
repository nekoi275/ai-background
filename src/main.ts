import './styles/index.css'
import { api } from './api.ts'
import { detectProductFile } from './lib/file-type.ts'
import { preparePhotoCutout, aiPhotoCutout } from './lib/image.ts'
import { $ } from './lib/dom.ts'
import { errorMessage } from './lib/error.ts'
import { formatSize } from './lib/format.ts'
import { setupDropzone } from './components/dropzone.ts'
import { loadModelFile } from './components/model-loader.ts'
import { createStudioScene } from './components/studio/index.ts'
import { setupResultView } from './components/result-view.ts'
import { runGenerate } from './generate.ts'
import type { LoadedProduct } from './product.ts'
import { setupProductCard } from './ui/product-card.ts'
import { setupSceneForm } from './ui/scene-form.ts'
import { setupWizard } from './ui/wizard.ts'

let product: LoadedProduct | null = null
let busy = false
let generating = false
let resultReached = false

const scene = createStudioScene($('scene'))
const dropzone = setupDropzone($('dropzone'), (file) => void handleProductFile(file))
const resultView = setupResultView($('result-root'), () => void generate())
const card = setupProductCard({
  onReplace: () => $('dropzone').click(),
  onUpgrade: () => void upgradePhotoCutout(),
})
const form = setupSceneForm({ scene, product: () => product })
const wizard = setupWizard({
  state: () => ({
    kind: product?.kind ?? null,
    busy,
    generating,
    resultReached,
  }),
  onEnterStep: (step) => {
    if (step === 3) prepPromptStep()
  },
  onGenerate: () => void generate(),
  onRestart: () => {
    resultReached = false
  },
})

const promptLead = $('prompt-lead')
const shotFigure = $('shot-figure')
const shotPreview = $<HTMLImageElement>('shot-preview')
const promptInput = $<HTMLTextAreaElement>('prompt')

async function handleProductFile(file: File): Promise<void> {
  if (busy) return
  busy = true
  wizard.refresh()
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
        data: null,
        size: null,
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
        size: { x: model.size.x, y: model.size.y, z: model.size.z },
        previewUrl: null,
        sourcePng: null,
        cutoutPng: null,
        canUpgradeCutout: false,
      }
    }
    scene.setProduct(product.data)
    dropzone.setFilled(product.name, product.previewUrl)
    if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl)
    form.reset()
    card.show(product)
    wizard.refresh()
  } catch (error) {
    dropzone.showError(errorMessage(error))
  } finally {
    busy = false
    wizard.refresh()
  }
}

async function upgradePhotoCutout(): Promise<void> {
  if (!product || product.kind !== 'photo' || !product.sourcePng || !product.canUpgradeCutout || busy) return
  busy = true
  card.setUpgrade(true)
  card.hideCutoutError()
  wizard.refresh()
  try {
    const cutout = await aiPhotoCutout(product.sourcePng, api.cutout)
    if (product.previewUrl) URL.revokeObjectURL(product.previewUrl)
    product.previewUrl = cutout.url
    product.cutoutPng = cutout.png
    product.details = `Photo · ${cutout.width} × ${cutout.height} px`
    product.canUpgradeCutout = false
    dropzone.setFilled(product.name, product.previewUrl)
    card.show(product)
    wizard.refresh()
  } catch (error) {
    card.showCutoutError(errorMessage(error))
  } finally {
    busy = false
    card.setUpgrade(false)
    wizard.refresh()
  }
}

function prepPromptStep(): void {
  promptLead.textContent = promptLeadText()
  shotFigure.hidden = product?.kind === 'photo'
  if (product?.kind !== 'photo') shotPreview.src = scene.captureView()
}

function promptLeadText(): string {
  const placement = form.placement
  const mounted = placement === 'wall' || placement === 'ceiling'
  if (product?.kind === 'photo') {
    if (placement === 'cover') {
      return 'The material covers the surfaces you selected; the prompt decides what the scene builds in front of it.'
    }
    if (mounted) {
      return 'The product is mounted into the scene you describe; the prompt decides the space around it.'
    }
    return 'The product is drawn straight into the scene you describe — no 3D placement is involved.'
  }
  if (placement === 'cover') {
    return 'The surfaces covered in your render stay covered; the prompt decides what the scene builds over them.'
  }
  if (mounted) {
    return 'The product stays exactly where you mounted it; the prompt decides the space around it.'
  }
  return 'The scene follows your camera exactly; the prompt decides what the space around the product is.'
}

async function generate(): Promise<void> {
  if (!product || generating) return
  generating = true
  wizard.refresh()
  wizard.setStep(4)
  const outcome = await runGenerate({
    product,
    prompt: promptInput.value.trim(),
    placement: form.placement,
    surfaces: form.placement === 'cover' ? form.coverSurfaces() : [],
    scene,
    resultView,
  })
  generating = false
  if (outcome) {
    resultReached = true
    resultView.showResult(outcome)
  }
  wizard.refresh()
}

card.show(product)
form.syncPlacementUI()
form.apply()
