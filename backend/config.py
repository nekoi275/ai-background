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


@dataclass(frozen=True)
class GenerationSettings:
    bg_model: str = os.environ.get("GEN_BG_MODEL", "SG161222/RealVisXL_V4.0")
    depth_model: str = os.environ.get(
        "GEN_DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Small-hf"
    )
    cn_model: str = os.environ.get(
        "GEN_CN_MODEL", "diffusers/controlnet-depth-sdxl-1.0"
    )
    steps: int = _env_int("GEN_STEPS", 32)
    guidance: float = _env_float("GEN_GUIDANCE", 7.0)
    cn_scale: float = _env_float("GEN_CN_SCALE", 0.65)
    cn_end: float = _env_float("GEN_CN_END", 0.75)
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

GEOMETRY_BASE = (
    "eye-level wide-angle photograph of the interior shown in the depth image, "
    "the room layout, walls and floor follow the depth map exactly, "
    "the center of the frame stays clear as the stage for the shot's main subject, "
    "everything else furnished and decorated in rich detail following the prompt, "
    "subtly glossy floor, highly detailed, sharp focus, photorealistic"
)

SCENE_NEG = (
    "people, person, text, watermark, logo, cartoon, painting, illustration, "
    "low quality,"
    "dark, gloomy, dirty floor, garbage, debris"
)

MIN_SIDE = 512
MAX_SIDE = 1536
DEFAULT_SIDE = 1024
KV_KEEP_SEEDS = 50

# Environment dictionary for Modal container images
IMAGE_ENV = {
    "HF_HOME": "/cache",
    "HF_HUB_ENABLE_HF_TRANSFER": "1",
    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    "GEN_STEPS": str(settings.steps),
    "GEN_GUIDANCE": str(settings.guidance),
    "GEN_CN_MODEL": settings.cn_model,
    "GEN_CN_SCALE": str(settings.cn_scale),
    "GEN_CN_END": str(settings.cn_end),
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
