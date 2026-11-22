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
    def photo_to_photo(
        self,
        product_png: bytes,
        prompt: str,
        seed: int,
        width: int,
        height: int,
    ) -> bytes:
        product = Image.open(io.BytesIO(product_png)).convert("RGB")
        rw, rh = max(256, (width // 16) * 16), max(256, (height // 16) * 16)
        print(f"[gen-photo] seed={seed} prompt={prompt!r} dims={rw}x{rh}", flush=True)
        out = self.pipe(
            image=[product],
            prompt=prompt,
            negative_prompt=EDIT_NEG,
            true_cfg_scale=settings.edit_guidance,
            num_inference_steps=settings.edit_steps,
            width=rw,
            height=rh,
            generator=self.torch.Generator("cuda").manual_seed(seed),
        ).images[0]
        if out.size != (rw, rh):
            out = out.resize((rw, rh), Image.Resampling.LANCZOS)
        if out.size != (width, height):
            out = out.resize((width, height), Image.Resampling.LANCZOS)
        return jpeg_bytes(out)

    @modal.method()
    def layout_to_photo(
        self,
        product_png: bytes,
        layout_png: bytes,
        plate_png: bytes,
        prompt: str,
        seed: int,
        width: int,
        height: int,
    ) -> bytes:
        from .compositing import restore_product

        product = Image.open(io.BytesIO(product_png)).convert("RGB")
        layout = Image.open(io.BytesIO(layout_png)).convert("RGB")
        plate = Image.open(io.BytesIO(plate_png)).convert("RGBA")
        rw, rh = max(256, (width // 16) * 16), max(256, (height // 16) * 16)
        layout = layout.resize((rw, rh), Image.Resampling.LANCZOS)

        best: Image.Image | None = None
        best_div = 9.0
        for attempt in range(settings.max_attempts):
            curr_seed = seed + attempt
            print(f"[gen] attempt={attempt + 1}/{settings.max_attempts} seed={curr_seed} prompt={prompt!r}", flush=True)
            out = self.pipe(
                image=[product, layout],
                prompt=prompt,
                negative_prompt=EDIT_NEG,
                true_cfg_scale=settings.edit_guidance,
                num_inference_steps=settings.edit_steps,
                width=rw,
                height=rh,
                generator=self.torch.Generator("cuda").manual_seed(curr_seed),
            ).images[0]
            if out.size != (rw, rh):
                out = out.resize((rw, rh), Image.Resampling.LANCZOS)
            final, div = restore_product(out, plate)
            print(f"[gen] seed={curr_seed} divergence={div:.3f}", flush=True)
            if div < best_div:
                best, best_div = final, div
            if div <= settings.max_divergence:
                break
        if best is None:
            raise RuntimeError("generation produced no result")
        if best.size != (width, height):
            best = best.resize((width, height), Image.Resampling.LANCZOS)
        return jpeg_bytes(best)

