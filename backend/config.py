import os
from dataclasses import dataclass


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


DEFAULT_GPUS: list[str] = ["L40S", "A100", "L4", "A10"]
EDIT_GPUS: list[str] = ["A100-80GB"]


def _gpu_list(raw: str | None, default: list[str]) -> list[str] | str:
    if not raw:
        return default
    gpus = [g.strip() for g in raw.split(",") if g.strip()]
    if not gpus:
        return default
    return gpus if len(gpus) > 1 else gpus[0]


def get_gpu_config() -> list[str] | str:
    return _gpu_list(os.environ.get("MODAL_GPU"), DEFAULT_GPUS)


def get_edit_gpu_config() -> list[str] | str:
    return _gpu_list(os.environ.get("MODAL_EDIT_GPU"), EDIT_GPUS)


@dataclass(frozen=True)
class GenerationSettings:
    bg_model: str = os.environ.get("GEN_BG_MODEL", "Qwen/Qwen-Image-2.1-Turbo")
    depth_model: str = os.environ.get(
        "GEN_DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Small-hf"
    )
    edit_model: str = os.environ.get("GEN_EDIT_MODEL", "Qwen/Qwen-Image-Edit-2511")
    edit_steps: int = _env_int("GEN_EDIT_STEPS", 40)
    edit_guidance: float = _env_float("GEN_EDIT_GUIDANCE", 4.0)
    steps: int = _env_int("GEN_STEPS", 8)
    guidance: float = _env_float("GEN_GUIDANCE", 1.0)
    dof_spread: float = _env_float("GEN_DOF_SPREAD", 0.7)
    focus_blur_max: float = _env_float("GEN_FOCUS_BLUR_MAX", 2.0)
    reflect_strength: float = _env_float("GEN_REFLECT_STRENGTH", 0.45)
    reflect_fade_frac: float = _env_float("GEN_REFLECT_FADE_FRAC", 0.3)
    reflect_blur: float = _env_float("GEN_REFLECT_BLUR", 2.5)
    shadow_strength: float = _env_float("GEN_SHADOW_STRENGTH", 0.5)
    shadow_blur: float = _env_float("GEN_SHADOW_BLUR", 6.0)
    bg_defocus: float = _env_float("GEN_BG_DEFOCUS", 0.6)
    product_sharpen: float = _env_float("GEN_PRODUCT_SHARPEN", 0.35)
    grain: float = _env_float("GEN_GRAIN", 1.3)
    api_token: str = os.environ.get("API_TOKEN", "").strip()


settings = GenerationSettings()

GEOMETRY_FLOOR_GLOSSY = "subtly glossy floor"
GEOMETRY_FLOOR_MATTE = "matte non-reflective floor"

GEOMETRY_BASE = (
    "photograph of the interior shown in the depth image, "
    "the room layout, walls and floor follow the depth map exactly, "
    "the center of the frame stays clear as the stage for the shot's main subject, "
    "everything else furnished and decorated in rich detail following the prompt, "
    "{floor}, highly detailed, sharp focus, photorealistic"
)


def geometry_base(glossy: bool) -> str:
    return GEOMETRY_BASE.format(
        floor=GEOMETRY_FLOOR_GLOSSY if glossy else GEOMETRY_FLOOR_MATTE
    )

EDIT_INSTRUCTION = (
    "Edit this photograph: a product has been placed into an interior scene "
    "and must look like it was photographed there. "
    "Keep the product exactly as it is in the input image, preserve its shape, "
    "proportions, colors, materials and all painted artwork precisely, "
    "never redraw, restyle or invent any new detail on the product. "
    "Relight the product so its illumination and white balance match the scene's "
    "ambient light, add subtle believable reflections of the surroundings on its "
    "surfaces, and ground it on the surface it stands on with a realistic contact "
    "shadow and soft ambient occlusion. Keep the product tack-sharp and the rest "
    "of the photograph unchanged, photorealistic, {floor}."
)


def edit_instruction(glossy: bool) -> str:
    return EDIT_INSTRUCTION.format(
        floor=GEOMETRY_FLOOR_GLOSSY if glossy else GEOMETRY_FLOOR_MATTE
    )

SCENE_NEG = (
    "people, person, text, watermark, logo, cartoon, painting, illustration, "
    "low quality,"
    "dark, gloomy, dirty floor, garbage, debris"
)

EDIT_NEG = (
    "hallucinated details on the product, altered pattern, distorted shape, "
    "extra elements, text, watermark, low quality"
)

MIN_SIDE = 512
MAX_SIDE = 1536
DEFAULT_SIDE = 1024
KV_KEEP_SEEDS = 50

IMAGE_ENV = {
    "HF_HOME": "/cache",
    "HF_HUB_ENABLE_HF_TRANSFER": "1",
    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    "GEN_STEPS": str(settings.steps),
    "GEN_GUIDANCE": str(settings.guidance),
    "GEN_EDIT_MODEL": settings.edit_model,
    "GEN_EDIT_STEPS": str(settings.edit_steps),
    "GEN_EDIT_GUIDANCE": str(settings.edit_guidance),
    "GEN_DOF_SPREAD": str(settings.dof_spread),
    "GEN_FOCUS_BLUR_MAX": str(settings.focus_blur_max),
    "GEN_REFLECT_STRENGTH": str(settings.reflect_strength),
    "GEN_REFLECT_FADE_FRAC": str(settings.reflect_fade_frac),
    "GEN_REFLECT_BLUR": str(settings.reflect_blur),
    "GEN_SHADOW_STRENGTH": str(settings.shadow_strength),
    "GEN_SHADOW_BLUR": str(settings.shadow_blur),
    "GEN_BG_DEFOCUS": str(settings.bg_defocus),
    "GEN_PRODUCT_SHARPEN": str(settings.product_sharpen),
    "GEN_GRAIN": str(settings.grain),
    "U2NET_HOME": "/cache/u2net",
}
