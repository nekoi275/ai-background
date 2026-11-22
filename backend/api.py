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

from .config import photo_instruction, render_instruction, settings
from .cutout import alpha_trimmed, cutout_product, product_reference
from .depth import jpeg_bytes, png_bytes
from .storage import RecoveryStorage


class GenerateParams(BaseModel):
    seed: int | None = None
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    prompt: str = ""


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
        """Poll endpoint for the spawned generation job."""
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
            detail = f"Generation failed: {type(exc).__name__}: {exc}"
            storage.put_chunks(f"compose_error_{seed}", detail.encode())
            raise HTTPException(500, detail=detail)

        storage.put_chunks(f"last_{seed}", jpeg)
        b64 = base64.b64encode(jpeg).decode()
        return {"image_b64": b64, "seed": seed, "recovered": False}

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

    @fast.post("/api/generate-photo")
    def generate_photo(
        product: UploadFile = File(...),
        params: str = Form("{}"),
        _auth: None = Depends(verify_token),
    ):
        p = parse_form_json(params, GenerateParams)
        seed = p.seed if p.seed is not None else random.randint(0, 2**31 - 1)
        try:
            src = Image.open(io.BytesIO(product.file.read())).convert("RGBA")
            ref_png = png_bytes(product_reference(src))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, f"Unreadable product: {exc}") from exc
        prompt = photo_instruction(p.prompt)
        print(f"[api.generate-photo] seed={seed} prompt={prompt!r} dims={p.width}x{p.height}", flush=True)
        call = model_factory().image_to_photo.spawn(
            image_png=ref_png,
            prompt=prompt,
            seed=seed,
            width=p.width,
            height=p.height,
        )
        storage.put_chunks(f"compose_call_{seed}", call.object_id.encode())
        storage.track_seed(seed)
        return {"seed": seed, "queued": True}

    @fast.post("/api/generate")
    def generate(
        render: UploadFile = File(...),
        params: str = Form("{}"),
        _auth: None = Depends(verify_token),
    ):
        p = parse_form_json(params, GenerateParams)
        seed = p.seed if p.seed is not None else random.randint(0, 2**31 - 1)
        prompt = render_instruction(p.prompt)
        print(f"[api.generate] seed={seed} prompt={prompt!r} dims={p.width}x{p.height}", flush=True)
        call = model_factory().image_to_photo.spawn(
            image_png=render.file.read(),
            prompt=prompt,
            seed=seed,
            width=p.width,
            height=p.height,
        )
        storage.put_chunks(f"compose_call_{seed}", call.object_id.encode())
        storage.track_seed(seed)
        return {"seed": seed, "queued": True}

    return fast

