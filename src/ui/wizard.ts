import { $ } from '../lib/dom.ts'

export type StepId = 1 | 2 | 3 | 4
const LAST_STEP: StepId = 4

export interface WizardState {
  kind: 'photo' | 'model' | null
  busy: boolean
  generating: boolean
  resultReached: boolean
}

export interface WizardDeps {
  state: () => WizardState
  onEnterStep: (step: StepId) => void
  onGenerate: () => void
  onRestart: () => void
}

export interface Wizard {
  readonly step: StepId
  setStep(next: StepId): void
  refresh(): void
}

export function setupWizard(deps: WizardDeps): Wizard {
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

  let step: StepId = 1

  function stepperReachable(target: StepId, state: WizardState): boolean {
    if (target === step) return true
    if (state.generating || step === LAST_STEP) return false
    if (target === 1) return true
    if (target === 2) return state.kind === 'model'
    if (target === LAST_STEP) return state.resultReached
    return state.kind !== null
  }

  function nextStep(): StepId {
    if (step === 1 && deps.state().kind === 'photo') return 3
    return Math.min(LAST_STEP, step + 1) as StepId
  }

  function previousStep(): StepId {
    if (step === 3 && deps.state().kind === 'photo') return 1
    return Math.max(1, step - 1) as StepId
  }

  function setStep(next: StepId): void {
    step = next
    for (const [id, section] of Object.entries(stepSections)) {
      section.hidden = Number(id) !== next
    }
    deps.onEnterStep(next)
    refresh()
  }

  function refresh(): void {
    const state = deps.state()
    stepperButtons.forEach((button, index) => {
      const target = (index + 1) as StepId
      button.classList.toggle('stepper__item--active', target === step)
      button.classList.toggle('stepper__item--done', target < step)
      button.disabled = !stepperReachable(target, state)
    })
    backButton.hidden = step === LAST_STEP
    backButton.disabled = step === 1 || state.generating
    restartButton.hidden = step !== LAST_STEP || state.generating
    nextButton.hidden = step === LAST_STEP
    nextButton.textContent = step === 3 ? 'Generate' : 'Next'
    nextButton.disabled =
      state.busy || state.generating || ((step === 1 || step === 2) && state.kind === null)
  }

  for (const button of stepperButtons) {
    button.addEventListener('click', () => {
      const target = Number(button.dataset.step) as StepId
      if (stepperReachable(target, deps.state())) setStep(target)
    })
  }
  backButton.addEventListener('click', () => setStep(previousStep()))
  nextButton.addEventListener('click', () => {
    if (step === 3) deps.onGenerate()
    else setStep(nextStep())
  })
  restartButton.addEventListener('click', () => {
    if (deps.state().generating) return
    deps.onRestart()
    setStep(1)
  })

  refresh()
  return { get step() { return step }, setStep, refresh }
}
