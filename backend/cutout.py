from PIL import Image
from fastapi import HTTPException

_cutout_session = None


def cutout_product(img: Image.Image) -> Image.Image:
    global _cutout_session
    from rembg import new_session, remove  # type: ignore[import-not-found]

    if _cutout_session is None:
        _cutout_session = new_session("u2net")
    return remove(img, session=_cutout_session).convert("RGBA")


def alpha_trimmed(cutout: Image.Image) -> Image.Image:
    bbox = cutout.split()[3].getbbox()
    if bbox is None:
        raise HTTPException(400, "the product image is empty after cutout")
    return cutout.crop(bbox)


def product_reference(rgba: Image.Image, max_side: int = 768, pad: float = 0.06) -> Image.Image:
    t = alpha_trimmed(rgba.convert("RGBA"))
    s = min(1.0, max_side / max(t.size))
    if s < 1.0:
        t = t.resize((max(1, round(t.width * s)), max(1, round(t.height * s))), Image.Resampling.LANCZOS)
    m = round(max(t.size) * pad)
    bg = Image.new("RGB", (t.width + 2 * m, t.height + 2 * m), (128, 128, 128))
    bg.paste(t, (m, m), t.split()[3])
    return bg

