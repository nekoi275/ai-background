import { api } from './api.ts'
import type { GenerateResult } from './api.ts'
import { dataUrlToBlob } from './lib/encode.ts'
import { describeError } from './lib/error.ts'
import type { Placement, StudioScene } from './components/studio/index.ts'
import type { LoadedProduct } from './product.ts'
import type { ResultView } from './components/result-view.ts'

const PHOTO_SIZE = { width: 1024, height: 1024 }

export interface GenerateInput {
  product: LoadedProduct
  prompt: string
  placement: Placement
  surfaces: string[]
  scene: StudioScene
  resultView: ResultView
}

export interface GenerateOutcome {
  imageUrl: string
  seed: number
  seconds: number
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
}

export async function runGenerate(input: GenerateInput): Promise<GenerateOutcome | null> {
  const { product, prompt, placement, surfaces, scene, resultView } = input
  const seed = randomSeed()
  const startedAt = performance.now()
  try {
    let result: GenerateResult
    if (product.kind === 'photo') {
      resultView.showStatus('Generating the photo…')
      result = await api.generatePhoto(
        { product: product.cutoutPng! },
        {
          seed,
          width: PHOTO_SIZE.width,
          height: PHOTO_SIZE.height,
          prompt,
          placement,
          surfaces,
        },
      )
    } else {
      resultView.showStatus('Rendering the scene…')
      const frame = scene.captureSize()
      const render = dataUrlToBlob(scene.captureView())
      const productRef = dataUrlToBlob(scene.captureProductReference())
      resultView.showStatus('Generating the photo…')
      result = await api.generate(
        { render, productRef },
        {
          seed,
          width: frame.width,
          height: frame.height,
          prompt,
          placement,
          surfaces,
        },
      )
    }
    return {
      imageUrl: `data:image/jpeg;base64,${result.image_b64}`,
      seed: result.seed,
      seconds: (performance.now() - startedAt) / 1000,
    }
  } catch (error) {
    resultView.showError(describeError(error))
    return null
  }
}
