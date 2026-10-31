import io
import modal
from PIL import Image
from .config import SCENE_NEG, settings
from .depth import depth_png_bytes, scene_depth_map


class Model:
    @modal.enter(snap=True)
    def load_weights(self):
        import torch  # type: ignore[import-not-found]

        if not hasattr(torch, "accelerator"):
            class _DummyAccelerator:
                @staticmethod
                def is_available():
                    return torch.cuda.is_available()

            torch.accelerator = _DummyAccelerator()  # type: ignore[attr-defined]

        from diffusers import (  # type: ignore[import-not-found]
            DiffusionPipeline,
        )

        self.torch = torch
        try:
            from diffusers import QwenImage21Pipeline  # type: ignore[import-not-found]
            pipeline_cls = QwenImage21Pipeline
        except ImportError:
            pipeline_cls = DiffusionPipeline

        self.pipe = pipeline_cls.from_pretrained(
            settings.bg_model,
            torch_dtype=torch.bfloat16,
        )

    @modal.enter()
    def start(self):
        from transformers import pipeline as hf_pipeline  # type: ignore[import-not-found]

        gpu_name = self.torch.cuda.get_device_name(0)
        total_vram_gb = (
            self.torch.cuda.get_device_properties(0).total_memory / (1024**3)
        )
        print(f"[Model] Initialized on GPU: {gpu_name} ({total_vram_gb:.1f} GB VRAM)")

        if total_vram_gb < 30:
            try:
                print("[Model] Enabling model CPU offload for 24GB GPU compatibility")
                self.pipe.enable_model_cpu_offload()
            except Exception as e:
                print(f"[Model] Could not enable model CPU offload ({e}), falling back to .to('cuda')")
                self.pipe.to("cuda")
        else:
            self.pipe.to("cuda")

        if hasattr(self.pipe, "enable_vae_tiling"):
            self.pipe.enable_vae_tiling()

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
        g = self.torch.Generator("cuda").manual_seed(seed)
        cond = Image.open(io.BytesIO(cond_png)).convert("RGB")
        if cond.size != (width, height):
            cond = cond.resize((width, height), Image.Resampling.BILINEAR)

        kwargs = {
            "prompt": prompt,
            "image": cond,
            "width": width,
            "height": height,
            "num_inference_steps": settings.steps,
            "generator": g,
        }
        if settings.guidance > 1.0 and neg:
            kwargs["true_cfg_scale"] = settings.guidance
            kwargs["negative_prompt"] = neg

        img = self.pipe(**kwargs).images[0]

        depth_png = depth_png_bytes(scene_depth_map(self.depth, img))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue(), depth_png

    @modal.method()
    def cutout(self, image_bytes: bytes) -> bytes:
        from .cutout import alpha_trimmed

        src = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = src.size

        dit_w = (w // 32) * 32 or 32
        dit_h = (h // 32) * 32 or 32
        resized = src.resize((dit_w, dit_h), Image.Resampling.BILINEAR)

        out = self.pipe(
            prompt="extract the main subject with transparent background, clean alpha channel",
            image=resized,
            width=dit_w,
            height=dit_h,
            num_inference_steps=settings.steps,
        ).images[0]

        out = out.convert("RGBA")
        if (dit_w, dit_h) != (w, h):
            out = out.resize((w, h), Image.Resampling.LANCZOS)

        trimmed = alpha_trimmed(out)
        buf = io.BytesIO()
        trimmed.save(buf, "PNG")
        return buf.getvalue()
