const EDGE_MATCH_FRACTION = 0.6
const TOLERANCE = 30
const MIN_REMOVED = 0.02
const MAX_REMOVED = 0.97
const MIN_COMPONENT = 0.005
const EDGE_FEATHER_PX = 1

interface Rgb {
  r: number
  g: number
  b: number
}

function borderColor(data: Uint8ClampedArray, width: number, height: number): Rgb | null {
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 512))
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4
    rs.push(data[i])
    gs.push(data[i + 1])
    bs.push(data[i + 2])
  }
  for (let x = 0; x < width; x += stride) {
    sample(x, 0)
    sample(x, height - 1)
  }
  for (let y = 0; y < height; y += stride) {
    sample(0, y)
    sample(width - 1, y)
  }
  const median = (values: number[]) => {
    values.sort((a, b) => a - b)
    return values[values.length >> 1]
  }
  const bg: Rgb = { r: median(rs), g: median(gs), b: median(bs) }
  const tol2 = TOLERANCE * TOLERANCE
  let matched = 0
  for (let i = 0; i < rs.length; i++) {
    const dr = rs[i] - bg.r
    const dg = gs[i] - bg.g
    const db = bs[i] - bg.b
    if (dr * dr + dg * dg + db * db <= tol2) matched++
  }
  return matched / rs.length >= EDGE_MATCH_FRACTION ? bg : null
}

function keyBackground(data: Uint8ClampedArray, width: number, height: number, bg: Rgb): number {
  const tol2 = TOLERANCE * TOLERANCE
  const matches = (i: number) => {
    const dr = data[i] - bg.r
    const dg = data[i + 1] - bg.g
    const db = data[i + 2] - bg.b
    return dr * dr + dg * dg + db * db <= tol2
  }
  const keyed = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    const p = y * width + x
    if (!keyed[p] && matches(p * 4)) stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  let removed = 0
  while (stack.length > 0) {
    const p = stack.pop()!
    if (keyed[p]) continue
    keyed[p] = 1
    removed++
    const x = p % width
    const y = (p / width) | 0
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
  const alpha = data
  for (let p = 0; p < keyed.length; p++) {
    if (keyed[p]) alpha[p * 4 + 3] = 0
  }
  return removed / keyed.length
}

function dropSpecks(data: Uint8ClampedArray, width: number, height: number): void {
  const total = width * height
  const label = new Int32Array(total)
  const stack: number[] = []
  const visit = (p: number, id: number) => {
    if (label[p] || data[p * 4 + 3] === 0) return
    label[p] = id
    stack.push(p)
  }
  let component = 0
  const sizes: number[] = []
  for (let start = 0; start < total; start++) {
    if (label[start] || data[start * 4 + 3] === 0) continue
    component++
    let size = 0
    stack.push(start)
    label[start] = component
    while (stack.length > 0) {
      const p = stack.pop()!
      size++
      const x = p % width
      const y = (p / width) | 0
      if (x > 0) visit(p - 1, component)
      if (x < width - 1) visit(p + 1, component)
      if (y > 0) visit(p - width, component)
      if (y < height - 1) visit(p + width, component)
    }
    sizes[component] = size
  }
  const minArea = MIN_COMPONENT * total
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] !== 0 && sizes[label[p]] < minArea) data[p * 4 + 3] = 0
  }
}

export async function chromaKeyCutout(png: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(png)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const bg = borderColor(image.data, canvas.width, canvas.height)
  if (!bg) return null
  const removed = keyBackground(image.data, canvas.width, canvas.height, bg)
  if (removed < MIN_REMOVED || removed > MAX_REMOVED) return null
  dropSpecks(image.data, canvas.width, canvas.height)
  ctx.putImageData(image, 0, 0)

  if (EDGE_FEATHER_PX > 0) {
    const mask = document.createElement('canvas')
    mask.width = canvas.width
    mask.height = canvas.height
    mask.getContext('2d')!.drawImage(canvas, 0, 0)
    const blurred = document.createElement('canvas')
    blurred.width = canvas.width
    blurred.height = canvas.height
    const bctx = blurred.getContext('2d')!
    bctx.filter = `blur(${EDGE_FEATHER_PX}px)`
    bctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(blurred, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }

  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
}
