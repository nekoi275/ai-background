import base64
import io
import json
import random
import time
import traceback
from typing import Any, Callable, TypeVar

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image

from .config import DEFAULT_SIDE, SCENE_NEG, edit_instruction, geometry_base, settings
from .cutout import alpha_trimmed, cutout_product
from .depth import (
    depth_cond_from_png,
    depth_map_from_png,
    jpeg_bytes,
    load_image,
    png_bytes,
    snap_resolution,
)
from .compositing import compose_classical
from .storage import RecoveryStorage


class SceneRequestParams(BaseModel):
    seed: int | None = None
    width: float = Field(default=DEFAULT_SIDE)
    height: float = Field(default=DEFAULT_SIDE)
    prompt: str = ""
    negative_prompt: str = ""
    glossy: bool = True


class ComposeRequestParams(BaseModel):
    seed: int | None = None
    glossy: bool = True


def verify_token(authorization: str | None = Header(None)) -> None:
    """Validate the incoming bearer token against configured API_TOKEN."""
    if not settings.api_token:
        raise HTTPException(
            status_code=503,
            detail="API_TOKEN is not configured on the backend",
        )
    if authorization != f"Bearer {settings.api_token}":
        raise HTTPException(
            status_code=401, detail="Invalid or missing bearer token"
        )


T = TypeVar("T", bound=BaseModel)


def parse_form_json(data: str, model_cls: type[T]) -> T:
    """Parse JSON string from a multipart form field into a Pydantic model."""
    try:
        raw = json.loads(data or "{}")
        return model_cls.model_validate(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid params JSON: {exc}"
        ) from exc


def create_app(
    storage: RecoveryStorage,
    harmonizer_factory: Callable[[], Any],
    model_factory: Callable[[], Any],
) -> FastAPI:
    """FastAPI application factory with dependency-injected storage and model."""
    fast = FastAPI(title="AI Background API")
    fast.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @fast.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        traceback.print_exc()
        headers = {"Access-Control-Allow-Origin": "*"}
        if isinstance(exc, HTTPException):
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=headers,
            )
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
            headers=headers,
        )

    @fast.get("/api/health")
    def health():
        return {"ok": True}

    @fast.get("/api/result/{seed}")
    def result(seed: int, _auth: None = Depends(verify_token)):
        """Poll endpoint for the spawned harmonize job."""
        try:
            jpeg = storage.get_chunks(f"last_{seed}")
        except KeyError:
            pass
        else:
            b64 = base64.b64encode(jpeg).decode()
            return {"image_b64": b64, "seed": seed, "recovered": True}

        try:
            stored = storage.get_chunks(f"compose_error_{seed}")
        except KeyError:
            stored = None
        if stored is not None:
            raise HTTPException(500, stored.decode())

        try:
            call_id = storage.get_chunks(f"compose_call_{seed}").decode()
        except KeyError:
            raise HTTPException(404, "result not ready")

        import modal

        call = modal.FunctionCall.from_id(call_id)
        try:
            jpeg = call.get(timeout=2)
        except (modal.exception.TimeoutError, TimeoutError):
            raise HTTPException(404, "result not ready")
        except Exception as exc:
            detail = f"Harmonize failed: {type(exc).__name__}: {exc}"
            storage.put_chunks(f"compose_error_{seed}", detail.encode())
            raise HTTPException(500, detail=detail)

        storage.put_chunks(f"last_{seed}", jpeg)
        b64 = base64.b64encode(jpeg).decode()
        return {"image_b64": b64, "seed": seed, "recovered": False}

    @fast.get("/api/scene-result/{seed}")
    def scene_result(seed: int, _auth: None = Depends(verify_token)):
        """Recovery endpoint for stage 1 scene generation."""
        try:
            raw = storage.get_chunks(f"scene_{seed}")
        except KeyError:
            raise HTTPException(404, "scene result not ready")
        return json.loads(raw)

    @fast.post("/api/cutout")
    def cutout(
        image: UploadFile = File(...),
        _auth: None = Depends(verify_token),
    ):
        """Product photo -> trimmed RGBA cutout PNG."""
        try:
            t0 = time.time()
            raw_bytes = image.file.read()
            src = Image.open(io.BytesIO(raw_bytes))
            rgba = src.convert("RGBA") if "A" in src.getbands() else None
            if rgba is not None:
                ext = rgba.getchannel("A").getextrema()
                if isinstance(ext[0], (int, float)) and ext[0] < 250:
                    out = alpha_trimmed(rgba)
                    buf = io.BytesIO()
                    out.save(buf, "PNG")
                    print(f"cutout bypass ok seconds={time.time() - t0:.1f}", flush=True)
                    return Response(content=buf.getvalue(), media_type="image/png")
            try:
                model_instance = model_factory()
                png_out = model_instance.cutout.remote(raw_bytes)
                print(f"cutout qwen ok seconds={time.time() - t0:.1f}", flush=True)
                return Response(content=png_out, media_type="image/png")
            except Exception as model_exc:
                print(
                    f"GPU cutout fallback to rembg ({type(model_exc).__name__}: {model_exc})",
                    flush=True,
                )
                cutout_img = cutout_product(src.convert("RGB"))
                out = alpha_trimmed(cutout_img)
                buf = io.BytesIO()
                out.save(buf, "PNG")
                print(f"cutout rembg ok seconds={time.time() - t0:.1f}", flush=True)
                return Response(content=buf.getvalue(), media_type="image/png")
        except HTTPException:
            raise
        except Exception as exc:
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Cutout failed: {type(exc).__name__}: {exc}",
            ) from exc

    @fast.post("/api/scene")
    def scene(
        params: str = Form("{}"),
        depth: UploadFile = File(...),
        _auth: None = Depends(verify_token),
    ):
        p = parse_form_json(params, SceneRequestParams)
        seed = (
            p.seed
            if p.seed is not None
            else random.randint(0, 2**31 - 1)
        )
        width = snap_resolution(p.width)
        height = snap_resolution(p.height)

        user_prompt = p.prompt.strip()
        prompt = (
            f"{user_prompt}, {geometry_base(p.glossy)}"
            if user_prompt
            else geometry_base(p.glossy)
        )
        neg = p.negative_prompt.strip() or SCENE_NEG
        raw_depth = depth.file.read()
        if not raw_depth:
            raise HTTPException(
                status_code=400,
                detail="depth file is required: depth-guided scene generation is mandatory",
            )

        t0 = time.time()
        try:
            cond_png = png_bytes(depth_cond_from_png(raw_depth, width, height))
            model_instance = model_factory()
            raw, depth_png = model_instance.compose_scene.remote(
                seed=seed,
                prompt=prompt,
                neg=neg,
                width=width,
                height=height,
                cond_png=cond_png,
            )
            scene_img = Image.open(io.BytesIO(raw)).convert("RGB")
            print(
                f"scene endpoint ok seed={seed} depth_png_bytes={len(depth_png)} "
                f"seconds={time.time() - t0:.1f}",
                flush=True,
            )
        except HTTPException:
            raise
        except Exception as exc:
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Scene generation failed: {type(exc).__name__}: {exc}",
            ) from exc

        resp = {
            "scene_b64": base64.b64encode(
                jpeg_bytes(scene_img, quality=92)
            ).decode(),
            "depth_b64": base64.b64encode(depth_png).decode(),
            "seed": seed,
            "width": width,
            "height": height,
            "seconds": round(time.time() - t0, 1),
            "cond_b64": base64.b64encode(cond_png).decode(),
        }
        storage.put_chunks(f"scene_{seed}", json.dumps(resp).encode())
        storage.track_seed(seed)
        return resp

    @fast.post("/api/compose")
    def compose(
        plate: UploadFile = File(...),
        scene: UploadFile = File(...),
        depth: UploadFile = File(...),
        reflection: UploadFile | None = File(None),
        shadow: UploadFile | None = File(None),
        params: str = Form("{}"),
        _auth: None = Depends(verify_token),
    ):
        p = parse_form_json(params, ComposeRequestParams)
        seed = (
            p.seed
            if p.seed is not None
            else random.randint(0, 2**31 - 1)
        )

        raw_depth = depth.file.read()
        if not raw_depth:
            raise HTTPException(
                status_code=400,
                detail="depth file is required: pass the scene response's depth_b64 "
                "as a 16-bit PNG (it drives depth-of-field)",
            )

        try:
            t0g = time.time()
            scene_img = load_image(scene.file.read(), "RGB")
            try:
                plate_src = Image.open(io.BytesIO(plate.file.read()))
            except Exception as exc:
                raise HTTPException(
                    400, detail=f"Unreadable product plate: {exc}"
                ) from exc

            width, height = scene_img.size
            dhat = depth_map_from_png(raw_depth, width, height)
            plate_img = plate_src.convert("RGBA")
            if plate_img.size != (width, height):
                plate_img = plate_img.resize(
                    (width, height), Image.Resampling.LANCZOS
                )

            reflection_img = None
            if reflection is not None and p.glossy:
                raw_refl = reflection.file.read()
                if raw_refl:
                    reflection_img = load_image(raw_refl, "RGBA")
                    if reflection_img.size != (width, height):
                        reflection_img = reflection_img.resize(
                            (width, height), Image.Resampling.LANCZOS
                        )

            shadow_img = None
            if shadow is not None:
                raw_shadow = shadow.file.read()
                if raw_shadow:
                    shadow_img = load_image(raw_shadow, "RGBA")
                    if shadow_img.size != (width, height):
                        shadow_img = shadow_img.resize(
                            (width, height), Image.Resampling.LANCZOS
                        )

            composited = compose_classical(
                plate_img,
                seed,
                width,
                height,
                scene_img=scene_img,
                dhat=dhat,
                reflection_img=reflection_img,
                shadow_img=shadow_img,
                with_grain=False,
            )
            buf = io.BytesIO()
            composited.save(buf, "PNG")

            harmonizer = harmonizer_factory()
            call = harmonizer.harmonize.spawn(
                image_png=buf.getvalue(),
                glossy=p.glossy,
                width=width,
                height=height,
                seed=seed,
            )
            storage.put_chunks(f"compose_call_{seed}", call.object_id.encode())
            storage.track_seed(seed)
            print(
                f"compose queued seed={seed} "
                f"classical_seconds={time.time() - t0g:.1f}",
                flush=True,
            )
            return {"seed": seed, "queued": True}
        except HTTPException:
            raise
        except Exception as exc:
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Composite failed: {type(exc).__name__}: {exc}",
            ) from exc

    return fast
