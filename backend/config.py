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


MOUNTED_RENDER_INSTRUCTION = (
    "Picture 1 (Image 1) is a 3D preview of a scene: a plain blockout room with a product "
    "mounted on the {surface}. Picture 2 (Image 2) is the same product photographed up close "
    "on a neutral gray background. "
    "Transform the preview in Picture 1 into a photorealistic, high-end commercial photograph of: {scene}. "
    "Strictly preserve the camera angle, perspective, framing, and the position of every object. "
    "The product must look exactly as it does in Picture 2: same shape, proportions, materials, colors, "
    "and every part and edge identical. "
    "Replace the flat placeholder surfaces with realistic physical surfaces matching the scene: "
    "textured walls, realistic flooring, realistic furniture surfaces around the product, "
    "and a realistic ceiling. "
    "Keep the lighting direction and shadows from the preview, and render natural contact shadows "
    "where the product meets the {surface}. Commercial advertising photography, crisp focus, photorealistic."
)


COVER_RENDER_INSTRUCTION = (
    "Picture 1 (Image 1) is a 3D preview of a room interior viewed from inside. "
    "Picture 2 (Image 2) is the tile or surface material. "
    "{coverage} "
    "Every covered surface is clad edge to edge: on each covered wall the tile runs from floor to "
    "ceiling and from corner to corner, and covered floors and ceilings are tiled across their full "
    "span — the tile continues beyond the visible frame wherever the surface continues. "
    "Keep the room structure of Picture 1: the same walls, floor and ceiling, with the material on "
    "exactly the same surfaces. "
    "Transform the preview in Picture 1 into a photorealistic, high-end commercial photograph of: {scene}. "
    "Keep the tile layout of Picture 1 exactly: same tile size, same tile proportions, same grout "
    "lines. Every tile must look exactly like the material in Picture 2: identical pattern, colors, "
    "proportions and relief, repeated evenly and seamlessly at the same scale. "
    "Furnish the room fully as described: furniture, cabinets, shelves and decor stand against and "
    "hang on the covered surfaces, naturally overlapping and occluding parts of them. "
    "Furniture, cabinets and countertops keep their own materials — wood, painted finishes, stone — "
    "distinct from the tile. "
    "Replace the flat placeholder surfaces elsewhere with realistic physical surfaces matching the scene. "
    "Keep the lighting direction and shadows from the preview, and render natural contact shadows "
    "where objects meet the covered surfaces. Commercial advertising photography, crisp focus, photorealistic."
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


MOUNTED_PHOTO_INSTRUCTION = (
    "Picture 1 (Image 1) is the product packshot on a neutral gray background. "
    "Do not change anything on the product and strictly preserve its details: "
    "shape, proportions, materials, colors, artwork, text, and branding. "
    "Draw this exact product naturally into the scene described by the user: {scene}. "
    "Mount the product firmly on the {surface} at a natural height and orientation, "
    "with correct scale and perspective, matching the scene lighting with a realistic "
    "contact shadow where it meets the {surface}. "
    "Photorealistic high-end commercial photography, crisp focus."
)


COVER_PHOTO_INSTRUCTION = (
    "Picture 1 (Image 1) is a sample of the tile or surface material on a neutral gray background. "
    "Do not change anything in the material and strictly preserve its details: "
    "pattern, colors, proportions, and texture. "
    "{coverage} "
    "Render the described scene: {scene}. "
    "Clad exactly those surfaces with this material, repeating it evenly and seamlessly at a realistic "
    "scale: every tile identical in pattern, color and proportions. "
    "Furniture, cabinets and countertops keep their own materials — wood, painted finishes, stone — "
    "distinct from the tile. "
    "Furnish the scene: furniture, cabinets, shelves and decor stand against and hang on the covered "
    "surfaces, naturally overlapping and occluding parts of them, matching the scene lighting with "
    "realistic contact shadows. "
    "Photorealistic high-end commercial photography, crisp focus."
)


def coverage_clause(surfaces: list[str] | None, picture: str = "", material: str = "this material") -> str:
    names = {"walls": "the walls", "floor": "the floor", "ceiling": "the ceiling"}
    order = [s for s in ("walls", "floor", "ceiling") if s in (surfaces or [])] or ["walls"]

    def join(items: list[str]) -> str:
        if len(items) == 1:
            return items[0]
        if len(items) == 2:
            return f"{items[0]} and {items[1]}"
        return f"{items[0]}, {items[1]} and {items[2]}"

    def verb(items: list[str]) -> str:
        return "is" if items == ["the floor"] or items == ["the ceiling"] else "are"

    covered = [names[s] for s in order]
    lead = f"In {picture}, " if picture else ""
    clause = f"{lead}exactly {join(covered)} {verb(covered)} covered with {material}."
    rest = [names[s] for s in ("walls", "floor", "ceiling") if s not in order]
    if rest:
        pronoun = "it" if len(rest) == 1 else "they"
        keep = "keeps" if len(rest) == 1 else "keep"
        rest_phrase = join(rest)
        rest_phrase = rest_phrase[0].upper() + rest_phrase[1:]
        clause += f" {rest_phrase} {verb(rest)} not covered with it: {pronoun} {keep} a distinct non-tile finish."
    return clause[0].upper() + clause[1:]


DEFAULT_SCENE = "a modern stylish interior with natural soft daylight"


def photo_instruction(scene: str, placement: str = "floor", surfaces: list[str] | None = None) -> str:
    scene_text = scene.strip() or DEFAULT_SCENE
    if placement == "cover":
        return COVER_PHOTO_INSTRUCTION.format(scene=scene_text, coverage=coverage_clause(surfaces))
    if placement in ("wall", "ceiling"):
        return MOUNTED_PHOTO_INSTRUCTION.format(scene=scene_text, surface=placement)
    return PHOTO_INSTRUCTION.format(scene=scene_text)


def render_instruction(scene: str, placement: str = "floor", surfaces: list[str] | None = None) -> str:
    scene_text = scene.strip() or DEFAULT_SCENE
    if placement == "cover":
        return COVER_RENDER_INSTRUCTION.format(
            scene=scene_text,
            coverage=coverage_clause(
                surfaces,
                picture="Picture 1 (Image 1)",
                material="the material from Picture 2 (Image 2)",
            ),
        )
    if placement in ("wall", "ceiling"):
        return MOUNTED_RENDER_INSTRUCTION.format(scene=scene_text, surface=placement)
    return RENDER_INSTRUCTION.format(scene=scene_text)


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
