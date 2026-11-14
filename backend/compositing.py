import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from .config import GenerationSettings, settings as default_settings


def sharpen_product(
    plate_img: Image.Image,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Mild unsharp on the product's RGB so it reads crisper than the
    DoF-blurred background and pops out of the scene."""
    if settings.product_sharpen <= 0:
        return plate_img
    r, g, b, a = plate_img.split()
    sharpened = Image.merge("RGB", (r, g, b)).filter(
        ImageFilter.UnsharpMask(
            radius=1.6,
            percent=int(settings.product_sharpen * 100),
            threshold=3,
        )
    )
    return Image.merge("RGBA", (*sharpened.split(), a))


def defringe_plate(plate_img: Image.Image) -> Image.Image:
    if plate_img.mode != "RGBA":
        return plate_img

    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return plate_img

    alpha = np.asarray(alpha_ch, np.float32) / 255.0
    if (alpha >= 0.999).all():
        return plate_img

    rgb = np.asarray(plate_img.convert("RGB"), np.float32)

    core_mask = (alpha > 0.70).astype(np.float32)
    if not core_mask.any():
        return plate_img

    core_rgb = rgb * core_mask[..., None]

    def _blur(arr: np.ndarray, radius: float) -> np.ndarray:
        if arr.ndim == 2:
            im = Image.fromarray((np.clip(arr, 0.0, 1.0) * 255.0).astype(np.uint8))
            return (
                np.asarray(
                    im.filter(ImageFilter.GaussianBlur(radius)), np.float32
                )
                / 255.0
            )
        else:
            im = Image.fromarray(np.clip(arr, 0.0, 255.0).astype(np.uint8))
            return np.asarray(
                im.filter(ImageFilter.GaussianBlur(radius)), np.float32
            )

    blurred_core_rgb = _blur(core_rgb, 2.5)
    blurred_weight = _blur(core_mask, 2.5)

    bleed_rgb = blurred_core_rgb / np.maximum(blurred_weight[..., None], 1e-4)

    border_factor = np.clip((0.85 - alpha) / 0.85, 0.0, 1.0)[..., None]
    decontaminated_rgb = rgb * (1.0 - border_factor) + bleed_rgb * border_factor

    clean_alpha = (
        alpha_ch.filter(ImageFilter.MinFilter(3))
        .filter(ImageFilter.GaussianBlur(0.5))
    )

    clean_rgb_im = Image.fromarray(
        np.clip(decontaminated_rgb, 0, 255).astype(np.uint8)
    )
    return Image.merge("RGBA", (*clean_rgb_im.split(), clean_alpha))


def contact_shadow(
    out: Image.Image,
    plate_img: Image.Image,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    if settings.shadow_strength <= 0:
        return out

    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return out

    width, height = out.size
    alpha = np.asarray(alpha_ch, np.float32) / 255.0
    y_idx, x_idx = np.where(alpha > 0.3)
    if len(y_idx) == 0:
        return out

    y1 = int(y_idx.max())

    y_bot = np.zeros(width, np.int32)
    for c in np.unique(x_idx):
        y_bot[c] = y_idx[x_idx == c].max()

    clearance = y1 - y_bot
    contact_cols = (alpha > 0.3).any(axis=0) & (clearance <= 4)
    if not contact_cols.any():
        contact_cols = (alpha > 0.3).any(axis=0)

    contact_x = np.where(contact_cols)[0]
    cx_min, cx_max = int(contact_x.min()), int(contact_x.max())
    cx_mid = (cx_min + cx_max) // 2
    contact_w = max(12, cx_max - cx_min)

    rx1 = int(contact_w * 0.70)
    ry1 = max(4, int(contact_w * 0.20))

    layer1 = Image.new("L", (width, height), 0)
    draw1 = ImageDraw.Draw(layer1)
    draw1.ellipse(
        [cx_mid - rx1, max(0, y1 - ry1 // 2), cx_mid + rx1, min(height, y1 + ry1 * 2)],
        fill=255,
    )
    layer1 = layer1.filter(ImageFilter.GaussianBlur(max(2.0, ry1 * 0.6)))
    m1 = (np.asarray(layer1, np.float32) / 255.0) * (settings.shadow_strength * 0.9)

    rx2 = int(contact_w * 1.15)
    ry2 = max(6, int(contact_w * 0.38))

    layer2 = Image.new("L", (width, height), 0)
    draw2 = ImageDraw.Draw(layer2)
    draw2.ellipse(
        [cx_mid - rx2, max(0, y1 - ry2 // 3), cx_mid + rx2, min(height, y1 + ry2 * 2)],
        fill=255,
    )
    layer2 = layer2.filter(ImageFilter.GaussianBlur(max(4.0, ry2 * 0.7)))
    m2 = (np.asarray(layer2, np.float32) / 255.0) * (settings.shadow_strength * 0.45)

    total_m = np.clip(m1 + m2, 0.0, 0.70)

    arr = np.asarray(out, np.float32)
    arr[..., :3] *= 1.0 - total_m[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def build_product_mask(plate_img: Image.Image) -> Image.Image:
    width, height = plate_img.size
    alpha = plate_img.split()[3]
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError(
            "product plate has no opaque pixels: cannot build the harmonize mask"
        )

    x0, y0, x1, y1 = bbox
    pw = max(1, x1 - x0)
    ph = max(1, y1 - y0)

    mask = Image.new("L", (width, height), 0)
    ring_arr = (np.asarray(alpha) > 8).astype(np.uint8) * 255
    ring = Image.fromarray(ring_arr, "L").filter(
        ImageFilter.MaxFilter(max(3, round(width * 0.025) | 1))
    )
    mask.paste(ring, (0, 0))

    draw = ImageDraw.Draw(mask)
    cx = (x0 + x1) / 2
    top = max(0, y0 - int(ph * 0.35))
    bottom = min(height, y1 + int(ph * 0.90))
    draw.polygon(
        [
            (cx - pw * 1.3 / 2, top),
            (cx + pw * 1.3 / 2, top),
            (cx + pw * 2.4 / 2, bottom),
            (cx - pw * 2.4 / 2, bottom),
        ],
        fill=255,
    )

    feather = max(1.0, width * 0.004)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def apply_grain(
    img: Image.Image,
    seed: int,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    if settings.grain <= 0:
        return img
    noise = np.random.default_rng(seed).normal(
        0.0, settings.grain, (img.height, img.width, 1)
    ).astype(np.float32)
    arr = np.asarray(img, dtype=np.float32) + noise
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def compose_classical(
    plate_img: Image.Image,
    seed: int,
    width: int,
    height: int,
    scene_img: Image.Image,
    dhat: np.ndarray,
    with_grain: bool = True,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Pixel-space compositing: DoF, paste, shadows, harmonization, grain."""
    if settings.bg_defocus > 0:
        scene_img = scene_img.filter(
            ImageFilter.GaussianBlur(settings.bg_defocus)
        )

    out = scene_img.copy()

    if settings.focus_blur_max > 0:
        spread = float(np.percentile(dhat, 97) - np.percentile(dhat, 3))
        if spread > 1e-6:
            alpha_arr = (
                np.asarray(plate_img.split()[3], np.float32) / 255.0
            )
            sel = alpha_arr > 0.5
            d_p = (
                float(np.median(dhat[sel]))
                if sel.any()
                else float(np.median(dhat))
            )
            t = (
                np.clip(
                    np.abs(dhat - d_p)
                    / max(settings.dof_spread * spread, 1e-6),
                    0,
                    1,
                )
                ** 1.1
            )
            blurred = out.filter(
                ImageFilter.GaussianBlur(settings.focus_blur_max)
            )
            arr = np.asarray(out, dtype=np.float32)
            blr = np.asarray(blurred, dtype=np.float32)
            out = Image.fromarray(
                np.clip(
                    arr * (1.0 - t)[..., None] + blr * t[..., None], 0, 255
                ).astype(np.uint8)
            )

    clean_plate = sharpen_product(plate_img, settings=settings)
    clean_plate = defringe_plate(clean_plate)

    out = contact_shadow(out, clean_plate, settings=settings)

    out.paste(clean_plate, (0, 0), clean_plate.split()[3])

    if with_grain:
        out = apply_grain(out, seed, settings=settings)

    return out
