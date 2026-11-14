import gc
import io
import modal
from PIL import Image
from .compositing import apply_grain
from .config import EDIT_NEG, edit_instruction, settings
from .depth import depth_png_bytes, jpeg_bytes, scene_depth_map


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
        if settings.guidance > 1.0:
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


class Harmonizer:
    def _build_pipe(self, edit_cls):
        return edit_cls.from_pretrained(
            settings.edit_model,
            torch_dtype=self.torch.bfloat16,
        )

    @modal.enter()
    def load(self):
        import torch  # type: ignore[import-not-found]

        if not hasattr(torch, "accelerator"):
            class _DummyAccelerator:
                @staticmethod
                def is_available():
                    return torch.cuda.is_available()

            torch.accelerator = _DummyAccelerator()  # type: ignore[attr-defined]

        from diffusers import QwenImageEditInpaintPipeline  # type: ignore[import-not-found]

        self.torch = torch
        total_vram_gb = (
            torch.cuda.get_device_properties(0).total_memory / (1024**3)
        )
        gpu_name = torch.cuda.get_device_name(0)

        strategies = []
        if total_vram_gb >= 60:
            strategies.append(("full-gpu resident", lambda p: p.to("cuda")))

        def group_leaf(pipe):
            pipe.enable_group_offload(
                onload_device=torch.device("cuda"),
                offload_device=torch.device("cpu"),
                offload_type="leaf_level",
            )

        strategies.append(("group-leaf streaming", group_leaf))
        strategies.append(
            ("model-cpu-offload", lambda p: p.enable_model_cpu_offload())
        )

        failures = []
        pipe = None
        mode = ""
        for name, strategy in strategies:
            pipe = self._build_pipe(QwenImageEditInpaintPipeline)
            try:
                strategy(pipe)
                mode = name
                break
            except Exception as e:
                failures.append(f"{name}: {type(e).__name__}: {e}")
                del pipe
                pipe = None
                gc.collect()
                torch.cuda.empty_cache()
        if pipe is None:
            raise RuntimeError(
                f"all Harmonizer memory strategies failed: {'; '.join(failures)}"
            )

        self.pipe = pipe
        print(
            f"[Harmonizer] ready on {gpu_name} ({total_vram_gb:.1f} GB VRAM), "
            f"memory strategy: {mode}, steps={settings.edit_steps}, "
            f"cfg={settings.edit_guidance}, strength={settings.edit_strength}"
            + (f" | failures: {'; '.join(failures)}" if failures else ""),
            flush=True,
        )

    @modal.method()
    def harmonize(
        self,
        image_png: bytes,
        mask_png: bytes,
        glossy: bool,
        width: int,
        height: int,
        seed: int,
    ) -> bytes:
        image = Image.open(io.BytesIO(image_png)).convert("RGB")
        mask = Image.open(io.BytesIO(mask_png)).convert("L")
        run_w = (width // 16) * 16
        run_h = (height // 16) * 16
        if image.size != (run_w, run_h):
            image = image.resize((run_w, run_h), Image.Resampling.LANCZOS)
            mask = mask.resize((run_w, run_h), Image.Resampling.LANCZOS)

        g = self.torch.Generator("cuda").manual_seed(seed)
        result = self.pipe(
            image=image,
            mask_image=mask,
            prompt=edit_instruction(glossy),
            negative_prompt=EDIT_NEG,
            true_cfg_scale=settings.edit_guidance,
            strength=settings.edit_strength,
            num_inference_steps=settings.edit_steps,
            generator=g,
        ).images[0]

        if result.size != (width, height):
            result = result.resize((width, height), Image.Resampling.LANCZOS)
        return jpeg_bytes(apply_grain(result, seed))
