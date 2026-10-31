import io
import numpy as np
from PIL import Image, ImageFilter
from .config import MAX_SIDE, MIN_SIDE


def snap_resolution(
    value: float, min_side: int = MIN_SIDE, max_side: int = MAX_SIDE
) -> int:
    snapped = (int(round(value)) // 64) * 64
    return max(min_side, min(max_side, snapped))


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def jpeg_bytes(img: Image.Image, quality: int = 95) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def load_image(raw: bytes, mode: str) -> Image.Image:
    return Image.open(io.BytesIO(raw)).convert(mode)


def downscaled(img: Image.Image, max_side: int = 768) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    if w >= h:
        return img.resize(
            (max_side, max(8, round(h * max_side / w))),
            Image.Resampling.BILINEAR,
        )
    return img.resize(
        (max(8, round(w * max_side / h)), max_side),
        Image.Resampling.BILINEAR,
    )


def scene_depth_map(depth_pipe, img: Image.Image) -> np.ndarray:
    small = downscaled(img, 640)
    out = depth_pipe(small)
    d = out["predicted_depth"]
    if hasattr(d, "cpu"):
        d = d.cpu()
    d = d.squeeze() if hasattr(d, "squeeze") else np.squeeze(d)
    d = np.asarray(d, dtype=np.float32)
    if d.ndim == 3:
        d = d[0]
    if d.ndim != 2 or d.size == 0:
        raise ValueError(
            f"unexpected depth output shape {np.shape(out['predicted_depth'])}"
        )
    return d


def depth_png_bytes(depth_map: np.ndarray) -> bytes:
    lo = float(depth_map.min())
    hi = float(depth_map.max())
    norm = np.clip((depth_map - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return png_bytes(Image.fromarray((norm * 65535.0).astype(np.uint16)))


def depth_map_from_png(raw: bytes, width: int, height: int) -> np.ndarray:
    arr = np.asarray(Image.open(io.BytesIO(raw)), dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[..., 0]
    d_img = Image.fromarray(arr)
    if d_img.size != (width, height):
        d_img = d_img.resize((width, height), Image.Resampling.BILINEAR)
    return np.asarray(d_img, dtype=np.float32)


def depth_cond_from_png(raw: bytes, width: int, height: int) -> Image.Image:
    img = Image.open(io.BytesIO(raw))
    if img.mode.startswith("I"):
        arr = np.asarray(img, dtype=np.float32)
        lo, hi = np.percentile(arr, 0.5), np.percentile(arr, 99.5)
        arr = 1.0 - np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1)
    else:
        arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    arr = arr + (
        np.random.default_rng().random(arr.shape, dtype=np.float32) - 0.5
    ) / 255.0
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "L")
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.BILINEAR)
    return img.filter(ImageFilter.GaussianBlur(1.0))
