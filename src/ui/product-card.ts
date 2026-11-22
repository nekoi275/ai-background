import { $ } from '../lib/dom.ts'
import type { LoadedProduct } from '../product.ts'

export interface ProductCardView {
  show(product: LoadedProduct | null): void
  setUpgrade(inProgress: boolean): void
  showCutoutError(message: string): void
  hideCutoutError(): void
}

export function setupProductCard(handlers: { onReplace: () => void; onUpgrade: () => void }): ProductCardView {
  const card = $('product-card')
  const badge = $('product-badge')
  const name = $('product-name')
  const details = $('product-details')
  const modelInfo = $('model-info')
  const cutoutTip = $('cutout-tip')
  const cutoutAiButton = $<HTMLButtonElement>('cutout-ai')
  const cutoutError = $('cutout-error')

  $('product-replace').addEventListener('click', handlers.onReplace)
  cutoutAiButton.addEventListener('click', handlers.onUpgrade)

  function show(product: LoadedProduct | null): void {
    card.hidden = !product
    if (!product) return
    badge.textContent = product.kind === 'photo' ? 'Photo' : '3D model'
    badge.classList.toggle('product-card__badge--model', product.kind === 'model')
    name.textContent = product.name
    details.textContent = product.details
    modelInfo.hidden = product.kind !== 'model'
    if (product.kind === 'model') modelInfo.textContent = product.details
    cutoutTip.hidden = !(product.kind === 'photo' && product.canUpgradeCutout)
    cutoutError.hidden = true
  }

  return {
    show,
    setUpgrade(inProgress) {
      cutoutAiButton.disabled = inProgress
      cutoutAiButton.textContent = inProgress ? 'Removing…' : 'Remove background with AI'
    },
    showCutoutError(message) {
      cutoutError.textContent = message
      cutoutError.hidden = false
    },
    hideCutoutError() {
      cutoutError.hidden = true
    },
  }
}
