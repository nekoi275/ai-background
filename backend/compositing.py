try:
    import cv2
except ImportError:
    cv2 = None
import numpy as np
from PIL import Image


def _get_cv2():
    global cv2
    if cv2 is None:
        import cv2
    return cv2


def _gray(rgb: np.ndarray) -> np.ndarray:
    cv = _get_cv2()
    g = cv.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv.COLOR_RGB2GRAY)
    return cv.GaussianBlur(g, (0, 0), 1.2).astype(np.float32)


def _estimate_warp(result: np.ndarray, plate_rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    cv = _get_cv2()
    inner = cv.erode((alpha > 0.5).astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv.findTransformECC(
            _gray(result), _gray(plate_rgb), warp, cv.MOTION_AFFINE,
            (cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 100, 1e-6), inner, 5)
        scale = float(np.sqrt(abs(np.linalg.det(warp[:, :2]))))
        if not (0.9 < scale < 1.1) or np.abs(warp[:, 2]).max() > 60:
            raise cv.error("implausible warp")
    except cv.error:
        warp = np.eye(2, 3, dtype=np.float32)
    print(f"[restore] warp={warp.round(3).tolist()}", flush=True)
    return warp


def restore_product(result: Image.Image, plate: Image.Image, sigma: float = 6.0):
    """Свет и цвет товара берём от модели, мелкие детали от оригинальной вырезки.
    Возвращает (картинка, расхождение 0..~1; чем больше, тем сильнее модель исказила товар)."""
    cv = _get_cv2()
    r = np.asarray(result.convert("RGB"), np.float32)
    p = np.asarray(plate.convert("RGBA").resize(result.size, Image.Resampling.LANCZOS), np.float32)
    a0 = p[..., 3] / 255.0
    if (a0 > 0.5).sum() < 500:
        raise ValueError("product plate is empty")

    warp = _estimate_warp(r, p[..., :3], a0)
    h, w = a0.shape
    prem = cv.warpAffine(np.dstack([p[..., :3] * a0[..., None], a0]).astype(np.float32),
                         warp, (w, h), flags=cv.INTER_LINEAR | cv.WARP_INVERSE_MAP)
    a = np.clip(prem[..., 3], 0, 1)
    rgb = prem[..., :3] / np.maximum(a, 1e-4)[..., None]

    den = np.maximum(cv.GaussianBlur(a, (0, 0), sigma), 1e-3)[..., None]
    nb = lambda x: cv.GaussianBlur(x * a[..., None], (0, 0), sigma) / den
    new = np.clip(nb(r) + (rgb - nb(rgb)), 0, 255)

    sob = lambda x: cv.Sobel(_gray(x), cv.CV_32F, 1, 1, ksize=3)
    inner = cv.erode((a > 0.5).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    div = 1.0
    if inner.sum() > 500:
        c = np.corrcoef(sob(r)[inner], sob(rgb)[inner])[0, 1]
        div = 1.0 - float(np.nan_to_num(c, nan=0.0))

    al = cv.GaussianBlur(a, (0, 0), 0.6)[..., None]
    out = r * (1 - al) + new * al
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)), div




