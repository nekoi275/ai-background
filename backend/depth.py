import io
from PIL import Image


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

