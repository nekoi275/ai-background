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
