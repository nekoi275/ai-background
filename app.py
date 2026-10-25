import base64
import io
import json
import os
import random
import time

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter

import modal


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


BG_MODEL = os.environ.get("GEN_BG_MODEL", "SG161222/RealVisXL_V4.0")
DEPTH_MODEL = os.environ.get("GEN_DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Small-hf")
GEN_CN_MODEL = os.environ.get("GEN_CN_MODEL", "diffusers/controlnet-depth-sdxl-1.0")
GEN_STEPS = _env_int("GEN_STEPS", 24)
GEN_GUIDANCE = _env_float("GEN_GUIDANCE", 6.5)
GEN_CN_SCALE = _env_float("GEN_CN_SCALE", 0.65)
GEN_CN_END = _env_float("GEN_CN_END", 0.75)
GEN_DOF_SPREAD = _env_float("GEN_DOF_SPREAD", 0.55)
FOCUS_BLUR_MAX = _env_float("GEN_FOCUS_BLUR_MAX", 2.5)
REFLECT_STRENGTH = _env_float("GEN_REFLECT_STRENGTH", 0.45)
REFLECT_FADE_FRAC = _env_float("GEN_REFLECT_FADE_FRAC", 0.3)
REFLECT_BLUR = _env_float("GEN_REFLECT_BLUR", 2.5)
SHADOW_STRENGTH = _env_float("GEN_SHADOW_STRENGTH", 0.5)
SHADOW_BLUR = _env_float("GEN_SHADOW_BLUR", 6.0)
BG_DEFOCUS = _env_float("GEN_BG_DEFOCUS", 1.2)
PRODUCT_SHARPEN = _env_float("GEN_PRODUCT_SHARPEN", 0.35)
GEN_GRAIN = _env_float("GEN_GRAIN", 1.3)
API_TOKEN = os.environ.get("API_TOKEN", "").strip()

GEOMETRY_BASE = (
    "eye-level wide-angle photograph of the interior shown in the depth image, "
    "the room layout, walls and floor follow the depth map exactly, "
    "smooth clean empty floor in the foreground with subtle glossy reflections, "
    "photorealistic"
)
SCENE_NEG = (
    "people, person, text, watermark, logo, cartoon, painting, illustration, "
    "low quality, blurry, clutter, debris, objects on the floor in the foreground, "
    "dark, gloomy, dirty floor"
)

MIN_SIDE = 512
MAX_SIDE = 1536
DEFAULT_SIDE = 1024

app = modal.App("ai-background")

_IMAGE_ENV = {"HF_HOME": "/cache",
              "HF_HUB_ENABLE_HF_TRANSFER": "1",
              "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
              "GEN_STEPS": str(GEN_STEPS),
              "GEN_GUIDANCE": str(GEN_GUIDANCE),
              "GEN_CN_MODEL": GEN_CN_MODEL,
              "GEN_CN_SCALE": str(GEN_CN_SCALE),
              "GEN_CN_END": str(GEN_CN_END),
              "GEN_DOF_SPREAD": str(GEN_DOF_SPREAD),
              "GEN_FOCUS_BLUR_MAX": str(FOCUS_BLUR_MAX),
              "GEN_REFLECT_STRENGTH": str(REFLECT_STRENGTH),
              "GEN_REFLECT_FADE_FRAC": str(REFLECT_FADE_FRAC),
              "GEN_REFLECT_BLUR": str(REFLECT_BLUR),
              "GEN_SHADOW_STRENGTH": str(SHADOW_STRENGTH),
              "GEN_SHADOW_BLUR": str(SHADOW_BLUR),
              "GEN_BG_DEFOCUS": str(BG_DEFOCUS),
              "GEN_PRODUCT_SHARPEN": str(PRODUCT_SHARPEN),
              "GEN_GRAIN": str(GEN_GRAIN),
              "U2NET_HOME": "/cache/u2net"}

gpu_image = (modal.Image.debian_slim(python_version="3.11")
             .pip_install("torch==2.4.1", "diffusers==0.31.0", "transformers==4.45.2",
                          "accelerate==1.0.1", "safetensors", "fastapi", "python-multipart",
                          "pillow", "numpy", "hf_transfer")
             .env(_IMAGE_ENV))

api_image = (modal.Image.debian_slim(python_version="3.11")
             .pip_install("fastapi", "python-multipart", "pillow", "numpy",
                          "rembg[cpu]>=2.0.57")
             .env(_IMAGE_ENV))

hf_vol = modal.Volume.from_name("hf-cache", create_if_missing=True)

kv = modal.Dict.from_name("ai-background-recovery", create_if_missing=True)
MIN = 60
KV_KEEP_SEEDS = 50


def _kv_put_chunks(key: str, data: bytes, chunk: int = 400_000) -> None:
    parts = max(1, (len(data) + chunk - 1) // chunk)
    for i in range(parts):
        kv.put(f"{key}#{i}", data[i * chunk:(i + 1) * chunk])
    kv.put(f"{key}#n", parts)


def _kv_get_chunks(key: str) -> bytes:
    parts = kv.get(f"{key}#n")
    if parts is None:
        raise KeyError(key)
    parts = int(parts)
    chunks = []
    for i in range(parts):
        value = kv.get(f"{key}#{i}")
        if value is None:
            raise KeyError(key)
        chunks.append(value)
    return b"".join(chunks)


def _kv_forget_seed(seed: int) -> None:
    for prefix in ("scene_", "last_"):
        key = f"{prefix}{seed}"
        parts = kv.get(f"{key}#n")
        if parts is None:
            continue
        for i in range(int(parts)):
            kv.pop(f"{key}#{i}", None)
        kv.pop(f"{key}#n", None)


def _kv_track_seed(seed: int) -> None:
    """Keep only the newest KV_KEEP_SEEDS stashed results (the recovery Dict
    has no TTL; without this it grows forever). Best-effort: pruning must
    never fail a generation."""
    try:
        recent = kv.get("recent")
        if not isinstance(recent, list):
            recent = []
        if seed in recent:
            recent.remove(seed)
        recent.append(seed)
        while len(recent) > KV_KEEP_SEEDS:
            _kv_forget_seed(int(recent.pop(0)))
        kv.put("recent", recent)
    except Exception:
        pass


@app.cls(image=gpu_image, gpu="L4", timeout=20 * MIN, scaledown_window=60,
         volumes={"/cache": hf_vol}, memory=16384,
         enable_memory_snapshot=True)
class Model:
    @modal.enter(snap=True)
    def load_weights(self):
        import torch
        from diffusers import (ControlNetModel,
                               StableDiffusionXLImg2ImgPipeline)
        self.torch = torch
        self.base = StableDiffusionXLImg2ImgPipeline.from_pretrained(
            BG_MODEL, torch_dtype=torch.float16, use_safetensors=True)
        self.controlnet = ControlNetModel.from_pretrained(
            GEN_CN_MODEL, torch_dtype=torch.float16)

    @modal.enter()
    def start(self):
        from diffusers import StableDiffusionXLControlNetPipeline
        from transformers import pipeline as hf_pipeline
        self.cn = StableDiffusionXLControlNetPipeline(
            **self.base.components, controlnet=self.controlnet).to("cuda")
        self.cn.enable_vae_tiling()
        self.cn.enable_vae_slicing()
        self.depth = hf_pipeline("depth-estimation", model=DEPTH_MODEL, device=0)

    @modal.method()
    def compose_scene(self, seed, prompt, neg, width, height, cond_png):
        """SDXL + ControlNet-Depth: paint the empty room locked to the cond
        geometry. Also computes the scene's Depth-Anything map here on
        the GPU so /api/compose stays torch-free; compose consumes it for
        depth-of-field. Returns (scene_png_bytes, depth_png_bytes)."""
        g = self.torch.Generator("cuda").manual_seed(seed)
        cond = Image.open(io.BytesIO(cond_png)).convert("L")
        if cond.size != (width, height):
            cond = cond.resize((width, height), Image.Resampling.BILINEAR)
        img = self.cn(prompt=prompt, negative_prompt=neg or SCENE_NEG,
                      image=cond, width=width, height=height,
                      num_inference_steps=GEN_STEPS,
                      guidance_scale=GEN_GUIDANCE,
                      controlnet_conditioning_scale=GEN_CN_SCALE,
                      control_guidance_start=0.0,
                      control_guidance_end=GEN_CN_END,
                      generator=g).images[0]
        depth_png = _depth_png_bytes(_scene_depth_map(self.depth, img))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue(), depth_png


def _snap(value: float) -> int:
    snapped = (int(round(value)) // 64) * 64
    return max(MIN_SIDE, min(MAX_SIDE, snapped))


def _png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _jpeg_bytes(img, quality: int = 95) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def _downscaled(img, max_side=768):
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    if w >= h:
        return img.resize((max_side, max(8, round(h * max_side / w))),
                          Image.Resampling.BILINEAR)
    return img.resize((max(8, round(w * max_side / h)), max_side),
                      Image.Resampling.BILINEAR)


def _scene_depth_map(depth_pipe, img):
    """Depth-Anything relative depth (larger = closer) for a scene image,
    computed on a downscaled copy: relative depth is smooth, bilinear
    upscale in _depth_map_from_png restores full resolution."""
    small = _downscaled(img, 640)
    out = depth_pipe(small)
    d = out["predicted_depth"]
    if hasattr(d, "cpu"):
        d = d.cpu()
    d = d.squeeze() if hasattr(d, "squeeze") else np.squeeze(d)
    d = np.asarray(d, dtype=np.float32)
    if d.ndim == 3:
        d = d[0]
    if d.ndim != 2 or d.size == 0:
        raise ValueError(f"unexpected depth output shape {np.shape(out['predicted_depth'])}")
    return d


def _depth_png_bytes(depth_map: np.ndarray) -> bytes:
    """Serialize a relative-depth map as a min-max normalized 16-bit PNG.
    The compose-side DoF math (median anchor, percentile spread) is
    affine-invariant, so the normalization carries no information loss."""
    lo = float(depth_map.min())
    hi = float(depth_map.max())
    norm = np.clip((depth_map - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return _png_bytes(Image.fromarray((norm * 65535.0).astype(np.uint16)))


def _depth_map_from_png(raw: bytes, width: int, height: int) -> np.ndarray:
    """Decode a 16-bit depth PNG (the scene response's depth_b64) to a float
    map at compose resolution."""
    arr = np.asarray(Image.open(io.BytesIO(raw)), dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[..., 0]
    d_img = Image.fromarray(arr)
    if d_img.size != (width, height):
        d_img = d_img.resize((width, height), Image.Resampling.BILINEAR)
    return np.asarray(d_img, dtype=np.float32)


def _depth_cond_from_png(raw: bytes, width: int, height: int) -> Image.Image:
    """Client-rendered empty-room Z-pass -> 8-bit cond (bright = closer).
    16-bit 'I' PNGs carry distances (far = large) and are inverted; 8-bit
    input is assumed to already follow the bright-closer convention."""
    img = Image.open(io.BytesIO(raw))
    if img.mode.startswith("I"):
        arr = np.asarray(img, dtype=np.float32)
        lo, hi = np.percentile(arr, 0.5), np.percentile(arr, 99.5)
        arr = 1.0 - np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1)
    else:
        arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "L")
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.BILINEAR)
    return img.filter(ImageFilter.GaussianBlur(1.0))


def _sharpen_product(plate_img):
    """Mild unsharp on the product's RGB so it reads crisper than the
    DoF-blurred background and pops out of the scene."""
    if PRODUCT_SHARPEN <= 0:
        return plate_img
    r, g, b, a = plate_img.split()
    sharpened = Image.merge("RGB", (r, g, b)).filter(
        ImageFilter.UnsharpMask(radius=1.6,
                                percent=int(PRODUCT_SHARPEN * 100),
                                threshold=3))
    return Image.merge("RGBA", (*sharpened.split(), a))


_cutout_session = None


def _cutout_product(img: Image.Image) -> Image.Image:
    """rembg cutout for product photos without transparency. Weights are
    cached on the shared volume via U2NET_HOME, so only the very first
    cold start downloads anything."""
    global _cutout_session
    from rembg import new_session, remove
    if _cutout_session is None:
        _cutout_session = new_session("u2net")
    return remove(img, session=_cutout_session).convert("RGBA")


def _alpha_trimmed(cutout: Image.Image) -> Image.Image:
    """Crop an RGBA cutout to the bounding box of its non-transparent
    pixels, so the frontend's object-size slider scales the content,
    not empty margins."""
    bbox = cutout.split()[3].getbbox()
    if bbox is None:
        raise HTTPException(400, "the product image is empty after cutout")
    return cutout.crop(bbox)


def _contact_shadow(out: Image.Image, plate_img: Image.Image) -> Image.Image:
    """Footprint shadow derived from the cutout's own silhouette (the 3D
    shadow pass is gone together with the 3D product): a tight dark core
    along the actual contact line — under every leg / the real base — plus
    a soft pool of the footprint spilled onto the floor in front, fading
    with distance. Light-direction-neutral by design: the painted scene's
    lighting is unknown."""
    alpha_ch = plate_img.split()[3]
    bbox = alpha_ch.getbbox()
    if bbox is None:
        return out
    width, height = out.size
    x0, y0, x1, y1 = bbox
    prod_h = max(1, y1 - y0)
    alpha = np.asarray(alpha_ch, np.float32) / 255.0

    def blurred(layer: np.ndarray, sigma: float) -> np.ndarray:
        return np.asarray(
            Image.fromarray((layer * 255).astype(np.uint8))
            .filter(ImageFilter.GaussianBlur(sigma)), np.float32) / 255.0

    band_h = max(3, round(prod_h * 0.06))
    base_band = alpha[max(y0, y1 - 2 * band_h):y1 + 1]
    occ_feet = (base_band > 0.35).any(axis=0).astype(np.float32)
    occ_full = (alpha[y0:y1 + 1] > 0.35).any(axis=0).astype(np.float32)

    core = np.zeros((height, width), np.float32)
    core[max(0, y1 - band_h):min(height, y1 + band_h + 1)] = occ_feet
    core = blurred(core, max(2.0, band_h * 0.7))

    pool_h = max(8, round(prod_h * 0.30))
    top = max(0, y1 - band_h // 2)
    pool = np.zeros((height, width), np.float32)
    pool[top:min(height, top + pool_h)] = occ_full
    pool = blurred(pool, pool_h * 0.30)
    fade = np.zeros(height, np.float32)
    span = min(height, top + pool_h) - top
    fade[:top] = 1.0
    fade[top:top + span] = np.linspace(1.0, 0.0, span)
    pool *= fade[:, None]

    m = np.clip(core * (SHADOW_STRENGTH * 1.05) + pool * (SHADOW_STRENGTH * 0.6),
                0.0, 0.65)
    protect = np.asarray(alpha_ch.filter(ImageFilter.MaxFilter(5)),
                         np.float32) / 255.0
    m *= (1.0 - protect)
    arr = np.asarray(out, np.float32)
    arr[..., :3] *= (1.0 - m[..., None])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _blend_reflection(out: Image.Image, reflection_img: Image.Image,
                      width: int, height: int) -> Image.Image:
    """Floor reflection from the 3D pass: the mirrored product rendered
    with the same camera/env. Blurred slightly, faded to nothing over the
    fade band below the contact line, composited onto the frame. Ported
    from the begra gpu-service."""
    if REFLECT_STRENGTH <= 0 or reflection_img is None:
        return out
    refl = reflection_img.resize((width, height), Image.Resampling.LANCZOS)
    ralpha = refl.split()[3]
    bbox = ralpha.getbbox()
    if bbox is None:
        return out
    fade_h = max(1, int(bbox[3] - bbox[1]))
    grad = np.ones((height, width), np.float32)
    ramp = np.linspace(1.0, 0.0, fade_h) ** max(1.0, 1.0 / REFLECT_FADE_FRAC)
    grad[bbox[1]:bbox[3], bbox[0]:bbox[2]] *= ramp[:, None]
    a = np.asarray(ralpha, np.float32) * grad * REFLECT_STRENGTH
    faded = refl.copy()
    faded.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    if REFLECT_BLUR > 0:
        faded = faded.filter(ImageFilter.GaussianBlur(REFLECT_BLUR))
    out = out.convert("RGBA")
    out.alpha_composite(faded)
    return out.convert("RGB")


def _blend_shadow_pass(out: Image.Image, shadow_img: Image.Image,
                       relit_plate: Image.Image) -> Image.Image:
    """Real 3D shadow pass (ShadowMaterial floor render): blurred, strength-
    scaled and multiplied onto the floor, with the product itself protected.
    Ported from the begra gpu-service."""
    shadow = shadow_img.resize(out.size, Image.Resampling.LANCZOS)
    m = np.asarray(shadow.split()[3].filter(
        ImageFilter.GaussianBlur(SHADOW_BLUR)), np.float32) / 255.0 * SHADOW_STRENGTH
    alpha = np.asarray(relit_plate.split()[3].filter(
        ImageFilter.MaxFilter(5)), np.float32) / 255.0
    m *= (1.0 - alpha)
    arr = np.asarray(out, np.float32)
    arr[..., :3] *= (1.0 - m[..., None])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _compose_generative(
    plate_img: Image.Image,
    seed: int,
    width: int,
    height: int,
    scene_img: Image.Image,
    dhat: np.ndarray,
    reflection_img: Image.Image | None = None,
    shadow_img: Image.Image | None = None,
) -> Image.Image:

    if BG_DEFOCUS > 0:
        scene_img = scene_img.filter(ImageFilter.GaussianBlur(BG_DEFOCUS))

    relit_plate = _sharpen_product(plate_img)
    out = scene_img.copy()
    paste_mask = (relit_plate.split()[3]
                  .filter(ImageFilter.MinFilter(3))
                  .filter(ImageFilter.GaussianBlur(0.6)))
    out.paste(relit_plate, (0, 0), paste_mask)
    if FOCUS_BLUR_MAX > 0:
        spread = float(np.percentile(dhat, 97) - np.percentile(dhat, 3))
        if spread > 1e-6:
            alpha_arr = np.asarray(relit_plate.split()[3], np.float32) / 255.0
            sel = alpha_arr > 0.5
            d_p = (float(np.median(dhat[sel])) if sel.any()
                   else float(np.median(dhat)))
            t = np.clip(
                np.abs(dhat - d_p) / max(GEN_DOF_SPREAD * spread, 1e-6), 0, 1
            ) ** 1.1
            protect = np.asarray(relit_plate.split()[3].filter(
                ImageFilter.MaxFilter(3)), np.float32) / 255.0
            t = t * (1.0 - protect)
            blurred = out.filter(ImageFilter.GaussianBlur(FOCUS_BLUR_MAX))
            arr = np.asarray(out, dtype=np.float32)
            blr = np.asarray(blurred, dtype=np.float32)
            out = Image.fromarray(np.clip(
                arr * (1 - t)[..., None] + blr * t[..., None],
                0, 255).astype(np.uint8))
    out = _blend_reflection(out, reflection_img, width, height)
    if shadow_img is not None:
        out = _blend_shadow_pass(out, shadow_img, relit_plate)
    else:
        out = _contact_shadow(out, relit_plate)
    if GEN_GRAIN > 0:
        noise = np.random.default_rng(seed).normal(
            0.0, GEN_GRAIN, (out.height, out.width, 1)).astype(np.float32)
        arr = np.asarray(out, dtype=np.float32) + noise
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return out


def _check_token(authorization: str | None) -> None:
    """Every endpoint behind the same gate: the bearer token must match
    API_TOKEN from the "ai-background" Modal secret. An empty API_TOKEN is
    a misconfiguration (the secret is mandatory on the api function), not
    an "auth off" switch."""
    if not API_TOKEN:
        raise HTTPException(status_code=503,
                            detail="API_TOKEN is not configured on the backend")
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


def _load_image(raw: bytes, mode: str) -> Image.Image:
    try:
        return Image.open(io.BytesIO(raw)).convert(mode)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unreadable image: {exc}") from exc


@app.function(image=api_image, cpu=2, memory=4096, timeout=10 * MIN,
               volumes={"/cache": hf_vol},
               secrets=[modal.Secret.from_name("ai-background")])
@modal.asgi_app()
def api():
    fast = FastAPI()
    fast.add_middleware(CORSMiddleware, allow_origins=["*"],
                        allow_methods=["*"], allow_headers=["*"])

    @fast.get("/api/health")
    def health():
        return {"ok": True}

    @fast.get("/api/result/{seed}")
    def result(seed: int, authorization: str | None = Header(None)):
        """Recovery endpoint: the last finished image for this seed. Long
        requests can be severed by proxies; the worker polls here instead of
        losing a finished generation. Served from network KV."""
        _check_token(authorization)
        try:
            jpeg = _kv_get_chunks(f"last_{seed}")
        except KeyError:
            raise HTTPException(404, "result not ready")
        b64 = base64.b64encode(jpeg).decode()
        return {"image_b64": b64, "seed": seed, "recovered": True}

    @fast.get("/api/scene-result/{seed}")
    def scene_result(seed: int, authorization: str | None = Header(None)):
        """Recovery twin of /api/result for stage 1: /api/scene stashes its
        response JSON here under the seed because Modal's proxy answers
        requests older than 150s with a 303 (which browsers follow into a
        non-JSON page) — the caller polls here instead of losing the
        finished generation."""
        _check_token(authorization)
        try:
            raw = _kv_get_chunks(f"scene_{seed}")
        except KeyError:
            raise HTTPException(404, "scene result not ready")
        return json.loads(raw)

    @fast.post("/api/cutout")
    def cutout(image: UploadFile = File(...),
               authorization: str | None = Header(None)):
        """Product photo → trimmed RGBA cutout PNG. A PNG that already
        carries real transparency is trimmed as-is; anything else is cut
        out with rembg. The frontend maps the result onto a billboard in
        the 3D room and renders the compositing plate client-side."""
        _check_token(authorization)
        try:
            t0 = time.time()
            src = Image.open(io.BytesIO(image.file.read()))
            rgba = src.convert("RGBA") if "A" in src.getbands() else None
            if rgba is not None and rgba.getextrema()[3][0] < 250:
                cutout_img = rgba
            else:
                cutout_img = _cutout_product(src.convert("RGB"))
            out = _alpha_trimmed(cutout_img)
            buf = io.BytesIO()
            out.save(buf, "PNG")
            print(f"cutout ok seconds={time.time() - t0:.1f}", flush=True)
            return Response(content=buf.getvalue(), media_type="image/png")
        except HTTPException:
            raise
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Cutout failed: {type(exc).__name__}: {exc}",
            ) from exc

    @fast.post("/api/scene")
    def scene(params: str = Form("{}"),
              depth: UploadFile = File(...),
              authorization: str | None = Header(None)):
        _check_token(authorization)
        try:
            p = json.loads(params or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid params JSON: {exc}") from exc
        try:
            seed = int(p["seed"]) if p.get("seed") is not None else random.randint(0, 2**31 - 1)
            width = _snap(float(p["width"])) if p.get("width") else DEFAULT_SIDE
            height = _snap(float(p["height"])) if p.get("height") else DEFAULT_SIDE
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="bad seed/width/height") from exc
        user_prompt = str(p.get("prompt", "")).strip()
        prompt = f"{user_prompt}, {GEOMETRY_BASE}" if user_prompt else GEOMETRY_BASE
        neg = str(p.get("negative_prompt", "")).strip() or SCENE_NEG
        raw_depth = depth.file.read()
        if not raw_depth:
            raise HTTPException(
                status_code=400,
                detail="depth file is required: depth-guided scene generation is mandatory")
        t0 = time.time()
        try:
            cond_png = _png_bytes(_depth_cond_from_png(raw_depth, width, height))

            raw, depth_png = Model().compose_scene.remote(
                seed=seed, prompt=prompt, neg=neg,
                width=width, height=height, cond_png=cond_png)
            scene_img = Image.open(io.BytesIO(raw)).convert("RGB")
            print(f"scene endpoint ok seed={seed} depth_png_bytes={len(depth_png)} "
                  f"seconds={time.time() - t0:.1f}", flush=True)
        except HTTPException:
            raise
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Scene generation failed: {type(exc).__name__}: {exc}",
            ) from exc
        resp = {
            "scene_b64": base64.b64encode(_jpeg_bytes(scene_img, quality=92)).decode(),
            "depth_b64": base64.b64encode(depth_png).decode(),
            "seed": seed,
            "width": width,
            "height": height,
            "seconds": round(time.time() - t0, 1),
        }
        resp["cond_b64"] = base64.b64encode(cond_png).decode()
        _kv_put_chunks(f"scene_{seed}", json.dumps(resp).encode())
        _kv_track_seed(seed)
        return resp

    @fast.post("/api/compose")
    def compose(
        plate: UploadFile = File(...),
        scene: UploadFile = File(...),
        depth: UploadFile = File(...),
        reflection: UploadFile | None = File(None),
        shadow: UploadFile | None = File(None),
        params: str = Form("{}"),
        authorization: str | None = Header(None),
    ):
        _check_token(authorization)
        try:
            p = json.loads(params or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid params JSON: {exc}") from exc
        try:
            seed = int(p["seed"]) if p.get("seed") is not None else random.randint(0, 2**31 - 1)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="bad seed") from exc

        raw_depth = depth.file.read()
        if not raw_depth:
            raise HTTPException(
                status_code=400,
                detail="depth file is required: pass the scene response's depth_b64 "
                       "as a 16-bit PNG (it drives depth-of-field)")

        try:
            t0g = time.time()
            scene_img = _load_image(scene.file.read(), "RGB")
            try:
                plate_src = Image.open(io.BytesIO(plate.file.read()))
            except Exception as exc:
                raise HTTPException(400,
                                    detail=f"Unreadable product plate: {exc}") from exc
            width, height = scene_img.size
            dhat = _depth_map_from_png(raw_depth, width, height)
            plate_img = plate_src.convert("RGBA")
            if plate_img.size != (width, height):
                plate_img = plate_img.resize((width, height),
                                             Image.Resampling.LANCZOS)
            reflection_img = None
            if reflection is not None:
                raw_refl = reflection.file.read()
                if raw_refl:
                    reflection_img = _load_image(raw_refl, "RGBA")
                    if reflection_img.size != (width, height):
                        reflection_img = reflection_img.resize(
                            (width, height), Image.Resampling.LANCZOS)
            shadow_img = None
            if shadow is not None:
                raw_shadow = shadow.file.read()
                if raw_shadow:
                    shadow_img = _load_image(raw_shadow, "RGBA")
                    if shadow_img.size != (width, height):
                        shadow_img = shadow_img.resize(
                            (width, height), Image.Resampling.LANCZOS)
            out = _compose_generative(plate_img, seed, width, height,
                                      scene_img=scene_img,
                                      dhat=dhat,
                                      reflection_img=reflection_img,
                                      shadow_img=shadow_img)
            print(f"generative pipeline ok seed={seed} "
                  f"seconds={time.time() - t0g:.1f}", flush=True)
            jpeg = _jpeg_bytes(out)
            _kv_put_chunks(f"last_{seed}", jpeg)
            _kv_track_seed(seed)
            b64 = base64.b64encode(jpeg).decode()
            return {"image_b64": b64, "seed": seed,
                    "seconds": round(time.time() - t0g, 1)}
        except HTTPException:
            raise
        except Exception as exc:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Composite failed: {type(exc).__name__}: {exc}",
            ) from exc

    return fast
