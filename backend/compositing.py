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


def harmonize_color(
    plate_img: Image.Image,
    scene_img: Image.Image,
    blend_strength: float = 0.14,
) -> Image.Image:
    if blend_strength <= 0:
        return plate_img

    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return plate_img

    x0, y0, x1, y1 = bbox
    width, height = scene_img.size
    alpha = np.asarray(alpha_ch, np.float32) / 255.0
    prod_mask = alpha > 0.4
    if not prod_mask.any():
        return plate_img

    plate_rgb = np.asarray(plate_img.convert("RGB"), np.float32)

    pad = max(20, int((y1 - y0) * 0.15))
    sx0 = max(0, x0 - pad)
    sy0 = max(0, y0 - pad)
    sx1 = min(width, x1 + pad)
    sy1 = min(height, y1 + pad)

    scene_crop = np.asarray(scene_img.convert("RGB"), np.float32)[sy0:sy1, sx0:sx1]
    if scene_crop.size == 0:
        return plate_img

    ambient_mean = np.median(scene_crop, axis=(0, 1))
    product_mean = np.median(plate_rgb[prod_mask], axis=0)

    ratio = ambient_mean / np.maximum(product_mean, 1.0)
    ratio = ratio / max(float(np.mean(ratio)), 1e-4)

    tint_scale = 1.0 - blend_strength + blend_strength * ratio
    harmonized = np.clip(plate_rgb * tint_scale, 0, 255)

    res_rgb = Image.fromarray(harmonized.astype(np.uint8))
    return Image.merge("RGBA", (*res_rgb.split(), alpha_ch))


def apply_light_wrap(
    plate_img: Image.Image,
    scene_img: Image.Image,
    wrap_strength: float = 0.20,
) -> Image.Image:
    if wrap_strength <= 0:
        return plate_img

    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return plate_img

    alpha = np.asarray(alpha_ch, np.float32) / 255.0
    inner_alpha = (
        np.asarray(alpha_ch.filter(ImageFilter.MinFilter(3)), np.float32)
        / 255.0
    )
    edge_band = np.clip(alpha - inner_alpha, 0.0, 1.0)
    if not (edge_band > 0.01).any():
        return plate_img

    bg_blurred = np.asarray(
        scene_img.filter(ImageFilter.GaussianBlur(3.0)), np.float32
    )
    plate_rgb = np.asarray(plate_img.convert("RGB"), np.float32)

    factor = (wrap_strength * edge_band)[..., None]
    wrapped_rgb = plate_rgb * (1.0 - factor) + bg_blurred * factor

    res_rgb = Image.fromarray(np.clip(wrapped_rgb, 0, 255).astype(np.uint8))
    return Image.merge("RGBA", (*res_rgb.split(), alpha_ch))


def apply_ground_bounce(
    plate_img: Image.Image,
    scene_img: Image.Image,
    bounce_strength: float = 0.30,
) -> Image.Image:
    if bounce_strength <= 0:
        return plate_img

    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return plate_img

    x0, y0, x1, y1 = bbox
    prod_h = max(1, y1 - y0)
    width, height = scene_img.size

    ground_band_h = max(6, min(40, int(prod_h * 0.12)))
    g_top = min(height - 1, y1)
    g_bot = min(height, y1 + ground_band_h)
    if g_bot <= g_top:
        return plate_img

    scene_rgb = np.asarray(scene_img.convert("RGB"), np.float32)
    ground_sample = scene_rgb[g_top:g_bot, max(0, x0) : min(width, x1)]
    if ground_sample.size == 0:
        return plate_img

    ground_color = np.median(ground_sample, axis=(0, 1)) / 255.0

    bounce_h = max(4, min(60, int(prod_h * 0.15)))
    p_top = max(y0, y1 - bounce_h)
    actual_h = y1 - p_top
    if actual_h <= 0:
        return plate_img

    ramp = (np.linspace(0.0, 1.0, actual_h) ** 1.4)[:, None, None]

    plate_arr = np.asarray(plate_img, np.float32).copy()
    product_slice = plate_arr[p_top:y1, max(0, x0) : min(width, x1), :3]

    tint = np.clip(ground_color * 1.8, 0.05, 1.2)
    bounced_slice = product_slice * tint

    factor = bounce_strength * ramp
    plate_arr[p_top:y1, max(0, x0) : min(width, x1), :3] = (
        product_slice * (1.0 - factor) + bounced_slice * factor
    )

    return Image.fromarray(np.clip(plate_arr, 0, 255).astype(np.uint8))


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


def blend_reflection(
    out: Image.Image,
    reflection_img: Image.Image | None,
    plate_img: Image.Image,
    width: int,
    height: int,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    if settings.reflect_strength <= 0:
        return out

    alpha_plate = plate_img.split()[3]
    prod_bbox = alpha_plate.getbbox()
    if prod_bbox is None:
        return out

    px0, py0, px1, py1 = prod_bbox
    prod_h = max(1, py1 - py0)

    refl = None
    if reflection_img is not None:
        refl_candidate = reflection_img.resize(
            (width, height), Image.Resampling.LANCZOS
        )
        refl_alpha = refl_candidate.split()[3]
        rbbox = refl_alpha.getbbox()
        if rbbox is not None:
            rx0, ry0, rx1, ry1 = rbbox
            dy = py1 - ry0
            if dy != 0:
                snapped = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                snapped.paste(refl_candidate, (0, dy))
                refl = snapped
            else:
                refl = refl_candidate

    if refl is None:
        refl_crop_h = min(prod_h, max(12, int(prod_h * 0.50)))
        plate_crop = plate_img.crop((px0, py1 - refl_crop_h, px1, py1))
        flipped = plate_crop.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        refl_h = max(4, int(refl_crop_h * 0.45))
        flipped = flipped.resize((px1 - px0, refl_h), Image.Resampling.LANCZOS)

        refl = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        refl.paste(flipped, (px0, py1))

    ralpha = refl.split()[3]
    rbbox = ralpha.getbbox()
    if rbbox is None:
        return out

    rx0, ry0, rx1, ry1 = rbbox
    fade_h = max(1, ry1 - ry0)
    grad = np.ones((height, width), np.float32)
    ramp = (
        np.linspace(1.0, 0.0, fade_h)
        ** max(1.0, 1.0 / settings.reflect_fade_frac)
    )
    grad[ry0:ry1, rx0:rx1] *= ramp[:, None]

    str_refl = min(0.35, settings.reflect_strength * 0.7)
    a = np.asarray(ralpha, np.float32) * grad * str_refl
    faded = refl.copy()
    faded.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    if settings.reflect_blur > 0:
        faded = faded.filter(ImageFilter.GaussianBlur(settings.reflect_blur))

    out = out.convert("RGBA")
    out.alpha_composite(faded)
    return out.convert("RGB")


def blend_shadow_pass(
    out: Image.Image,
    shadow_img: Image.Image | None,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """3D shadow pass: blurred, scaled by shadow_strength and multiplied onto the floor."""
    if settings.shadow_strength <= 0 or shadow_img is None:
        return out
    shadow = shadow_img.resize(out.size, Image.Resampling.LANCZOS)
    m = (
        np.asarray(
            shadow.split()[3].filter(
                ImageFilter.GaussianBlur(settings.shadow_blur)
            ),
            np.float32,
        )
        / 255.0
        * settings.shadow_strength
    )
    arr = np.asarray(out, np.float32)
    arr[..., :3] *= 1.0 - np.clip(m[..., None], 0.0, 0.85)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


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
    reflection_img: Image.Image | None = None,
    shadow_img: Image.Image | None = None,
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

    out = blend_reflection(
        out, reflection_img, clean_plate, width, height, settings=settings
    )

    if shadow_img is not None:
        out = blend_shadow_pass(out, shadow_img, settings=settings)
    else:
        out = contact_shadow(out, clean_plate, settings=settings)

    clean_plate = harmonize_color(clean_plate, out)
    clean_plate = apply_ground_bounce(clean_plate, out)

    final_plate = apply_light_wrap(clean_plate, out)

    paste_mask = final_plate.split()[3]
    out.paste(final_plate, (0, 0), paste_mask)

    if with_grain:
        out = apply_grain(out, seed, settings=settings)

    return out
