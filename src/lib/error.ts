export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function describeError(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Could not reach the generation backend through the API proxy. In dev, check MODAL_API_URL/API_TOKEN in .env.local and restart the dev server.'
  }
  return errorMessage(error)
}
