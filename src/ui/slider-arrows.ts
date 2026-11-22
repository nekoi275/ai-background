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

export function updateSliderArrows(): void {
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

export function setupSliderArrows(): void {
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
