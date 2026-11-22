export function formatSize(size: { x: number; y: number; z: number }): string {
  return `${size.x.toFixed(2)} × ${size.z.toFixed(2)} × ${size.y.toFixed(2)} m (W × D × H)`
}
