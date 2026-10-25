export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  return base64ToBlob(dataUrl.slice(dataUrl.indexOf(',') + 1), 'image/png')
}
