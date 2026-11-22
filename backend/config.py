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
    api_token: str = os.environ.get("API_TOKEN", "").strip()


settings = GenerationSettings()

EDIT_NEG = (
    "3d render, cgi, mockup, computer graphics, low poly, flat shading, "
    "solid untextured planes, pastel planes, cartoon, illustration, low quality, "
    "blurry, watermark, people"
)

RENDER_INSTRUCTION = (
    "Picture 1 (Image 1) is a 3D preview of a scene: a plain blockout room with a product "
    "standing inside it. Picture 2 (Image 2) is the same product photographed up close "
    "on a neutral gray background. "
    "Transform the preview in Picture 1 into a photorealistic, high-end commercial photograph of: {scene}. "
    "Strictly preserve the camera angle, perspective, framing, and the position of every object. "
    "The product must look exactly as it does in Picture 2: same shape, proportions, materials, colors, "
    "and every part and edge identical. "
    "Replace the flat placeholder surfaces with realistic physical surfaces matching the scene: "
    "textured walls, realistic flooring, realistic furniture surfaces under and around the product, "
    "and a realistic ceiling. "
    "Keep the lighting direction and shadows from the preview, and render a natural contact shadow "
    "under the product. Commercial advertising photography, crisp focus, photorealistic."
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


def render_instruction(scene: str) -> str:
    return RENDER_INSTRUCTION.format(
        scene=scene.strip() or "a modern stylish interior with natural soft daylight"
    )


KV_KEEP_SEEDS = 50

IMAGE_ENV = {
    "HF_HOME": "/cache",
    "HF_HUB_ENABLE_HF_TRANSFER": "1",
    "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    "GEN_EDIT_MODEL": settings.edit_model,
    "GEN_EDIT_STEPS": str(settings.edit_steps),
    "GEN_EDIT_GUIDANCE": str(settings.edit_guidance),
    "U2NET_HOME": "/cache/u2net",
}
