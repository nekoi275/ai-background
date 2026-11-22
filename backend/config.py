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


DEFAULT_GPUS: list[str] = ["A100-80GB"]


def _gpu_list(raw: str | None, default: list[str]) -> list[str] | str:
    if not raw:
        return default
    gpus = [g.strip() for g in raw.split(",") if g.strip()]
    if not gpus:
        return default
    return gpus if len(gpus) > 1 else gpus[0]


def get_gpu_config() -> list[str] | str:
    return _gpu_list(os.environ.get("MODAL_GPU"), DEFAULT_GPUS)


@dataclass(frozen=True)
class GenerationSettings:
    edit_model: str = os.environ.get("GEN_EDIT_MODEL", "Qwen/Qwen-Image-Edit-2511")
    edit_steps: int = _env_int("GEN_EDIT_STEPS", 30)
    edit_guidance: float = _env_float("GEN_EDIT_GUIDANCE", 4.0)
    max_attempts: int = _env_int("GEN_MAX_ATTEMPTS", 2)
    max_divergence: float = _env_float("GEN_MAX_DIVERGENCE", 0.35)
    api_token: str = os.environ.get("API_TOKEN", "").strip()


settings = GenerationSettings()

EDIT_NEG = (
    "3d render, cgi, mockup, computer graphics, low poly, flat shading, "
    "solid untextured planes, pastel planes, cartoon, illustration, low quality, "
    "blurry, watermark, people"
)

LAYOUT_INSTRUCTION = (
    "Picture 1 (Image 1) is the product packshot on a neutral gray background. "
    "Picture 2 (Image 2) is a rough 3D room blockout layout mockup with a placeholder for the product. "
    "Transform the 3D layout from Picture 2 into a photorealistic, high-end commercial photograph of: {scene}. "
    "Strictly preserve the camera angle, perspective, spatial depth, and room layout from Picture 2. "
    "Turn the flat 3D mockup planes from Picture 2 into realistic physical surfaces matching the scene: "
    "replace the flat wall planes with realistic textured walls, "
    "replace the floor plane with realistic flooring (such as hardwood, tile, stone, or concrete){table}, "
    "and replace the ceiling plane with a realistic ceiling. "
    "Do not keep the solid pastel 3D shader colors or flat CGI planes of Picture 2. "
    "Place the exact product from Picture 1 in the position of the placeholder in Picture 2, "
    "faithfully preserving its shape, proportions, packaging, artwork, and branding. "
    "Relight the product to match the room lighting naturally, casting a realistic contact shadow "
    "and surface reflection. Commercial advertising photography, crisp focus, photorealistic."
)


PHOTO_INSTRUCTION = (
    "Picture 1 (Image 1) is the product packshot on a neutral gray background. "
    "Do not change anything on the product and strictly preserve its details: "
    "shape, proportions, materials, colors, artwork, text, and branding. "
    "Draw this exact product naturally into the scene described by the user: {scene}. "
    "The product must sit believably in the environment with correct scale and perspective, "
    "matching the scene lighting with a realistic soft contact shadow. "
    "Photorealistic high-end commercial photography, crisp focus."
)


def photo_instruction(scene: str) -> str:
    return PHOTO_INSTRUCTION.format(
        scene=scene.strip() or "a modern stylish interior with natural soft daylight"
    )


def layout_instruction(scene: str, table_visible: bool, table_shape: str = "box") -> str:
    if not table_visible:
        table = ""
    elif table_shape == "cylinder":
        table = ", replace the round cylinder block with a realistic round table or pedestal"
    else:
        table = ", replace the rectangular block with a realistic table, desk, or podium"
    return LAYOUT_INSTRUCTION.format(
        scene=scene.strip() or "a modern stylish interior with natural soft daylight",
        table=table,
    )


KV_KEEP_SEEDS = 50

IMAGE_ENV = {
    "HF_HOME": "/cache",
    "HF_HUB_ENABLE_HF_TRANSFER": "1",
    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    "GEN_EDIT_MODEL": settings.edit_model,
    "GEN_EDIT_STEPS": str(settings.edit_steps),
    "GEN_EDIT_GUIDANCE": str(settings.edit_guidance),
    "GEN_MAX_ATTEMPTS": str(settings.max_attempts),
    "GEN_MAX_DIVERGENCE": str(settings.max_divergence),
    "U2NET_HOME": "/cache/u2net",
}
