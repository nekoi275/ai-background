import io
import modal
from PIL import Image
from .config import SCENE_NEG, settings
from .depth import depth_png_bytes, scene_depth_map


class Model:
    """SDXL + ControlNet-Depth generator with Depth-Anything estimation."""

    @modal.enter(snap=True)
    def load_weights(self):
        import torch  # type: ignore[import-not-found]
        from diffusers import (  # type: ignore[import-not-found]
            ControlNetModel,
            StableDiffusionXLImg2ImgPipeline,
        )

        self.torch = torch
        self.base = StableDiffusionXLImg2ImgPipeline.from_pretrained(
            settings.bg_model, torch_dtype=torch.float16, use_safetensors=True
        )
        self.controlnet = ControlNetModel.from_pretrained(
            settings.cn_model, torch_dtype=torch.float16
        )

    @modal.enter()
    def start(self):
        from diffusers import (  # type: ignore[import-not-found]
            StableDiffusionXLControlNetPipeline,
        )
        from transformers import pipeline as hf_pipeline  # type: ignore[import-not-found]

        self.cn = StableDiffusionXLControlNetPipeline(
            **self.base.components, controlnet=self.controlnet
        ).to("cuda")
        self.cn.enable_vae_tiling()
        self.cn.enable_vae_slicing()
        self.depth = hf_pipeline(
            "depth-estimation", model=settings.depth_model, device=0
        )

    @modal.method()
    def compose_scene(
        self,
        seed: int,
        prompt: str,
        neg: str,
        width: int,
        height: int,
        cond_png: bytes,
    ) -> tuple[bytes, bytes]:
        """SDXL + ControlNet-Depth: paint the empty room locked to the cond
        geometry. Also computes the scene's Depth-Anything map here on
        the GPU so /api/compose stays torch-free; compose consumes it for
        depth-of-field. Returns (scene_png_bytes, depth_png_bytes)."""
        g = self.torch.Generator("cuda").manual_seed(seed)
        cond = Image.open(io.BytesIO(cond_png)).convert("L")
        if cond.size != (width, height):
            cond = cond.resize((width, height), Image.Resampling.BILINEAR)

        img = self.cn(
            prompt=prompt,
            negative_prompt=neg or SCENE_NEG,
            image=cond,
            width=width,
            height=height,
            num_inference_steps=settings.steps,
            guidance_scale=settings.guidance,
            controlnet_conditioning_scale=settings.cn_scale,
            control_guidance_start=0.0,
            control_guidance_end=settings.cn_end,
            generator=g,
        ).images[0]

        depth_png = depth_png_bytes(scene_depth_map(self.depth, img))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue(), depth_png
