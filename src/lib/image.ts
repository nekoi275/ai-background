const MAX_SIDE = 1536

function toCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return canvas
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('failed to encode PNG')
  return png
}

export async function normalizeImageToPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvasToPng(canvas)
}

export async function pngHasRealAlpha(png: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(png)
  const data = toCanvas(bitmap).getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data
  bitmap.close()
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true
  }
  return false
}

export async function trimAlphaPng(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png)
  const { width, height } = bitmap
  const data = toCanvas(bitmap).getContext('2d')!.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  bitmap.close()
  if (x1 === -1) return png

  const source = await createImageBitmap(png)
  const canvas = document.createElement('canvas')
  canvas.width = x1 - x0 + 1
  canvas.height = y1 - y0 + 1
  canvas.getContext('2d')!.drawImage(source, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  source.close()
  return canvasToPng(canvas)
}

export interface PhotoCutout {
  png: Blob
  url: string
  aspect: number
  width: number
  height: number
}

export async function preparePhotoCutout(
  file: File,
  remoteCutout: (png: Blob) => Promise<Blob>,
): Promise<PhotoCutout> {
  const png = await normalizeImageToPng(file)
  const cutout = (await pngHasRealAlpha(png)) ? await trimAlphaPng(png) : await remoteCutout(png)
  const bitmap = await createImageBitmap(cutout)
  const result: PhotoCutout = {
    png: cutout,
    url: URL.createObjectURL(cutout),
    aspect: bitmap.width / bitmap.height,
    width: bitmap.width,
    height: bitmap.height,
  }
  bitmap.close()
  return result
}
