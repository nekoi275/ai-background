import gc
import io
import modal
from PIL import Image
from .config import EDIT_NEG, settings
from .depth import jpeg_bytes


class Model:
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

        try:
            from diffusers import QwenImageEditPlusPipeline  # type: ignore[import-not-found]
            edit_pipeline_cls = QwenImageEditPlusPipeline
        except ImportError:
            from diffusers import DiffusionPipeline  # type: ignore[import-not-found]
            edit_pipeline_cls = DiffusionPipeline

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
            pipe = self._build_pipe(edit_pipeline_cls)
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
                f"all Model memory strategies failed: {'; '.join(failures)}"
            )

        self.pipe = pipe
        print(
            f"[Model] ready on {gpu_name} ({total_vram_gb:.1f} GB VRAM), "
            f"pipeline: {edit_pipeline_cls.__name__}, memory strategy: {mode}, "
            f"steps={settings.edit_steps}, cfg={settings.edit_guidance}"
            + (f" | failures: {'; '.join(failures)}" if failures else ""),
            flush=True,
        )

    @modal.method()
    def image_to_photo(
        self,
        image_png: bytes,
        prompt: str,
        seed: int,
        width: int,
        height: int,
    ) -> bytes:
        image = Image.open(io.BytesIO(image_png)).convert("RGB")
        rw, rh = max(256, (width // 16) * 16), max(256, (height // 16) * 16)
        print(f"[gen] seed={seed} prompt={prompt!r} dims={rw}x{rh}", flush=True)
        out = self.pipe(
            image=[image],
            prompt=prompt,
            negative_prompt=EDIT_NEG,
            true_cfg_scale=settings.edit_guidance,
            num_inference_steps=settings.edit_steps,
            width=rw,
            height=rh,
            generator=self.torch.Generator("cuda").manual_seed(seed),
        ).images[0]
        if out.size != (width, height):
            out = out.resize((width, height), Image.Resampling.LANCZOS)
        return jpeg_bytes(out)

    @modal.method()
    def render_to_photo(
        self,
        render_png: bytes,
        ref_png: bytes,
        prompt: str,
        seed: int,
        width: int,
        height: int,
    ) -> bytes:
        render = Image.open(io.BytesIO(render_png)).convert("RGB")
        ref = Image.open(io.BytesIO(ref_png)).convert("RGB")
        rw, rh = max(256, (width // 16) * 16), max(256, (height // 16) * 16)
        render = render.resize((rw, rh), Image.Resampling.LANCZOS)
        print(f"[gen-3d] seed={seed} render={rw}x{rh} ref={ref.size} prompt={prompt!r}", flush=True)
        out = self.pipe(
            image=[render, ref],
            prompt=prompt,
            negative_prompt=EDIT_NEG,
            true_cfg_scale=settings.edit_guidance,
            num_inference_steps=settings.edit_steps,
            width=rw,
            height=rh,
            generator=self.torch.Generator("cuda").manual_seed(seed),
        ).images[0]
        if out.size != (width, height):
            out = out.resize((width, height), Image.Resampling.LANCZOS)
        return jpeg_bytes(out)

