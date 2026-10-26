import numpy as np
from PIL import Image, ImageFilter
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


def contact_shadow(
    out: Image.Image,
    plate_img: Image.Image,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Footprint shadow derived from the cutout's own silhouette (the 3D
    shadow pass is gone together with the 3D product): a tight dark core
    along the actual contact line — under every leg / the real base — plus
    a soft pool of the footprint spilled onto the floor in front, fading
    with distance. Light-direction-neutral by design: the painted scene's
    lighting is unknown."""
    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return out
    width, height = out.size
    x0, y0, x1, y1 = bbox
    prod_h = max(1, y1 - y0)
    alpha = np.asarray(alpha_ch, np.float32) / 255.0

    def blurred(layer: np.ndarray, sigma: float) -> np.ndarray:
        return (
            np.asarray(
                Image.fromarray((layer * 255).astype(np.uint8)).filter(
                    ImageFilter.GaussianBlur(sigma)
                ),
                np.float32,
            )
            / 255.0
        )

    band_h = max(3, round(prod_h * 0.06))
    base_band = alpha[max(y0, y1 - 2 * band_h) : y1 + 1]
    occ_feet = (base_band > 0.35).any(axis=0).astype(np.float32)
    occ_full = (alpha[y0 : y1 + 1] > 0.35).any(axis=0).astype(np.float32)

    core = np.zeros((height, width), np.float32)
    core[max(0, y1 - band_h) : min(height, y1 + band_h + 1)] = occ_feet
    core = blurred(core, max(2.0, band_h * 0.7))

    pool_h = max(8, round(prod_h * 0.30))
    top = max(0, y1 - band_h // 2)
    pool = np.zeros((height, width), np.float32)
    pool[top : min(height, top + pool_h)] = occ_full
    pool = blurred(pool, pool_h * 0.30)
    fade = np.zeros(height, np.float32)
    span = min(height, top + pool_h) - top
    fade[:top] = 1.0
    fade[top : top + span] = np.linspace(1.0, 0.0, span)
    pool *= fade[:, None]

    m = np.clip(
        core * (settings.shadow_strength * 1.05)
        + pool * (settings.shadow_strength * 0.6),
        0.0,
        0.65,
    )
    protect = (
        np.asarray(alpha_ch.filter(ImageFilter.MaxFilter(5)), np.float32)
        / 255.0
    )
    m *= 1.0 - protect
    arr = np.asarray(out, np.float32)
    arr[..., :3] *= 1.0 - m[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def blend_reflection(
    out: Image.Image,
    reflection_img: Image.Image | None,
    width: int,
    height: int,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Floor reflection from the 3D pass: the mirrored product rendered
    with the same camera/env. Blurred slightly, faded to nothing over the
    fade band below the contact line, composited onto the frame."""
    if settings.reflect_strength <= 0 or reflection_img is None:
        return out
    refl = reflection_img.resize((width, height), Image.Resampling.LANCZOS)
    ralpha = refl.split()[3]
    bbox = ralpha.getbbox()
    if bbox is None:
        return out
    fade_h = max(1, int(bbox[3] - bbox[1]))
    grad = np.ones((height, width), np.float32)
    ramp = (
        np.linspace(1.0, 0.0, fade_h)
        ** max(1.0, 1.0 / settings.reflect_fade_frac)
    )
    grad[bbox[1] : bbox[3], bbox[0] : bbox[2]] *= ramp[:, None]
    a = np.asarray(ralpha, np.float32) * grad * settings.reflect_strength
    faded = refl.copy()
    faded.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    if settings.reflect_blur > 0:
        faded = faded.filter(ImageFilter.GaussianBlur(settings.reflect_blur))
    out = out.convert("RGBA")
    out.alpha_composite(faded)
    return out.convert("RGB")


def blend_shadow_pass(
    out: Image.Image,
    shadow_img: Image.Image,
    relit_plate: Image.Image,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Real 3D shadow pass (ShadowMaterial floor render): blurred, strength-
    scaled and multiplied onto the floor, with the product itself protected."""
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
    alpha = (
        np.asarray(
            relit_plate.split()[3].filter(ImageFilter.MaxFilter(5)), np.float32
        )
        / 255.0
    )
    m *= 1.0 - alpha
    arr = np.asarray(out, np.float32)
    arr[..., :3] *= 1.0 - m[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def compose_generative(
    plate_img: Image.Image,
    seed: int,
    width: int,
    height: int,
    scene_img: Image.Image,
    dhat: np.ndarray,
    reflection_img: Image.Image | None = None,
    shadow_img: Image.Image | None = None,
    settings: GenerationSettings = default_settings,
) -> Image.Image:
    """Execute the post-render generative composition pipeline."""
    if settings.bg_defocus > 0:
        scene_img = scene_img.filter(
            ImageFilter.GaussianBlur(settings.bg_defocus)
        )

    relit_plate = sharpen_product(plate_img, settings=settings)
    out = scene_img.copy()
    paste_mask = (
        relit_plate.split()[3]
        .filter(ImageFilter.MinFilter(3))
        .filter(ImageFilter.GaussianBlur(0.6))
    )
    out.paste(relit_plate, (0, 0), paste_mask)

    if settings.focus_blur_max > 0:
        spread = float(np.percentile(dhat, 97) - np.percentile(dhat, 3))
        if spread > 1e-6:
            alpha_arr = (
                np.asarray(relit_plate.split()[3], np.float32) / 255.0
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
            protect = (
                np.asarray(
                    relit_plate.split()[3].filter(ImageFilter.MaxFilter(3)),
                    np.float32,
                )
                / 255.0
            )
            t = t * (1.0 - protect)
            blurred = out.filter(
                ImageFilter.GaussianBlur(settings.focus_blur_max)
            )
            arr = np.asarray(out, dtype=np.float32)
            blr = np.asarray(blurred, dtype=np.float32)
            out = Image.fromarray(
                np.clip(
                    arr * (1 - t)[..., None] + blr * t[..., None], 0, 255
                ).astype(np.uint8)
            )

    out = blend_reflection(
        out, reflection_img, width, height, settings=settings
    )
    if shadow_img is not None:
        out = blend_shadow_pass(out, shadow_img, relit_plate, settings=settings)
    else:
        out = contact_shadow(out, relit_plate, settings=settings)

    if settings.grain > 0:
        noise = np.random.default_rng(seed).normal(
            0.0, settings.grain, (out.height, out.width, 1)
        ).astype(np.float32)
        arr = np.asarray(out, dtype=np.float32) + noise
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    return out
