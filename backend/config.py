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
    edit_steps: int = _env_int("GEN_EDIT_STEPS", 24)
    edit_guidance: float = _env_float("GEN_EDIT_GUIDANCE", 4.0)
    edit_strength: float = _env_float("GEN_EDIT_STRENGTH", 1.0)
    steps: int = _env_int("GEN_STEPS", 8)
    guidance: float = _env_float("GEN_GUIDANCE", 1.0)
    dof_spread: float = _env_float("GEN_DOF_SPREAD", 0.7)
    focus_blur_max: float = _env_float("GEN_FOCUS_BLUR_MAX", 2.0)
    bg_defocus: float = _env_float("GEN_BG_DEFOCUS", 0.6)
    product_sharpen: float = _env_float("GEN_PRODUCT_SHARPEN", 0.35)
    grain: float = _env_float("GEN_GRAIN", 1.3)
    api_token: str = os.environ.get("API_TOKEN", "").strip()


settings = GenerationSettings()

GEOMETRY_FLOOR_GLOSSY = "subtly glossy floor"
GEOMETRY_FLOOR_MATTE = "matte non-reflective floor"

GEOMETRY_BASE = (
    "photograph of the interior defined by the reference depth map, "
    "light areas of the depth map are close to the camera and dark areas are far, "
    "reproduce the walls, the floor and every piece of furniture exactly as the "
    "depth map shows them, keeping their shape, position and scale, "
    "{furniture}"
    "furnish and decorate the room in rich detail following the description, "
    "{floor}, highly detailed, sharp focus, photorealistic"
)

TABLE_PHRASES = {
    "box": (
        "the pale block in the center is the table from the description, "
        "render it exactly there with its exact silhouette, "
    ),
    "cylinder": (
        "the pale round block in the center is the round table from the "
        "description, render it exactly there with its round silhouette, "
    ),
}

NO_TABLE_PHRASE = (
    "the center of the floor stays clear as the stage for the shot's main subject, "
)


def geometry_base(
    glossy: bool, table_visible: bool = False, table_shape: str = "box"
) -> str:
    furniture = (
        TABLE_PHRASES.get(table_shape, TABLE_PHRASES["box"])
        if table_visible
        else NO_TABLE_PHRASE
    )
    return GEOMETRY_BASE.format(
        furniture=furniture,
        floor=GEOMETRY_FLOOR_GLOSSY if glossy else GEOMETRY_FLOOR_MATTE,
    )

EDIT_INSTRUCTION = (
    "Edit the photograph inside the masked region, which covers the product "
    "and the surface under it. "
    "Relight the product so its illumination matches the scene's ambient "
    "light, ground it on the surface so it sits there naturally with its "
    "base touching the surface, and draw {surface}. "
    "Never alter the product's shape, proportions, colors, materials or "
    "painted artwork, and keep everything outside the masked region exactly "
    "as it is. Photorealistic."
)

EDIT_SURFACE_GLOSSY = (
    "a softly blurred reflection of the product and a clear contact shadow"
)

EDIT_SURFACE_MATTE = "only a soft diffuse contact shadow"


def edit_instruction(glossy: bool) -> str:
    return EDIT_INSTRUCTION.format(
        surface=EDIT_SURFACE_GLOSSY if glossy else EDIT_SURFACE_MATTE
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
    "GEN_EDIT_STRENGTH": str(settings.edit_strength),
    "GEN_DOF_SPREAD": str(settings.dof_spread),
    "GEN_FOCUS_BLUR_MAX": str(settings.focus_blur_max),
    "GEN_BG_DEFOCUS": str(settings.bg_defocus),
    "GEN_PRODUCT_SHARPEN": str(settings.product_sharpen),
    "GEN_GRAIN": str(settings.grain),
    "U2NET_HOME": "/cache/u2net",
}
