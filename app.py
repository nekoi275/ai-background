import base64, io, json, os, random, time, uuid
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

import modal

DEPTH_FLIP = False

BG_MODEL = "SG161222/RealVisXL_V4.0"

BG_PROMPT = ("interior of a spacious industrial warehouse, smooth polished concrete floor, high ceiling, "
             "tall steel shelving racks with cardboard boxes and stacked pallets along the far walls, "
             "bright soft daylight, empty clear floor in the foreground, eye level photo, photorealistic, "
             "professional product photography")
NEG = ("people, person, text, watermark, logo, cartoon, painting, illustration, low quality, "
       "clutter, debris, mess, objects on the floor in the foreground, cluttered foreground")

app = modal.App("poc-bg")

image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("torch==2.4.1", "diffusers==0.31.0", "transformers==4.45.2",
                      "accelerate==1.0.1", "safetensors", "fastapi", "python-multipart",
                      "pillow", "numpy", "hf_transfer")
         .env({"HF_HOME": "/cache", "HF_HUB_ENABLE_HF_TRANSFER": "1"}))

hf_vol = modal.Volume.from_name("hf-cache", create_if_missing=True)
assets_vol = modal.Volume.from_name("poc-assets", create_if_missing=True)
MIN = 60


@app.cls(image=image, gpu="L4", timeout=20 * MIN, scaledown_window=60,
         volumes={"/cache": hf_vol})
class Model:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import StableDiffusionXLPipeline
        self.torch = torch
        self.bg = StableDiffusionXLPipeline.from_pretrained(
            BG_MODEL, torch_dtype=torch.float16, use_safetensors=True).to("cuda")

    def _cn(self):
        if getattr(self, "cn_pipe", None) is None:
            from diffusers import ControlNetModel, StableDiffusionXLControlNetPipeline
            cn = ControlNetModel.from_pretrained("diffusers/controlnet-depth-sdxl-1.0",
                                                 torch_dtype=self.torch.float16)
            self.cn_pipe = StableDiffusionXLControlNetPipeline(
                **self.bg.components, controlnet=cn).to("cuda")
        return self.cn_pipe

    def _inp(self):
        if getattr(self, "inp_pipe", None) is None:
            from diffusers import StableDiffusionXLInpaintPipeline
            full = StableDiffusionXLInpaintPipeline.from_pretrained(
                "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
                torch_dtype=self.torch.float16, variant="fp16", use_safetensors=True)
            c = self.bg.components
            self.inp_pipe = StableDiffusionXLInpaintPipeline(
                vae=c["vae"], text_encoder=c["text_encoder"],
                text_encoder_2=c["text_encoder_2"], tokenizer=c["tokenizer"],
                tokenizer_2=c["tokenizer_2"], unet=full.unet,
                scheduler=c["scheduler"]).to("cuda")
            del full
        return self.inp_pipe

    def _dep(self):
        if getattr(self, "dep_pipe", None) is None:
            from transformers import pipeline as hf_pipeline
            self.dep_pipe = hf_pipeline("depth-estimation",
                                        model="depth-anything/Depth-Anything-V2-Small-hf",
                                        device="cuda")
        return self.dep_pipe

    def _gen(self, seed, prompt, neg=None, depth_img=None):
        g = self.torch.Generator("cuda").manual_seed(seed)
        kw = dict(prompt=prompt or BG_PROMPT,
                  negative_prompt=neg or NEG, width=1024, height=1024,
                  num_inference_steps=28, guidance_scale=6.5, generator=g)
        if depth_img is not None:
            kw.update(image=depth_img, controlnet_conditioning_scale=0.85)
            return self._cn()(**kw).images[0]
        return self.bg(**kw).images[0]

    @modal.method()
    def gen_batch(self, n, user_prompt):
        out = []
        for _ in range(n):
            seed = random.randint(0, 2**31 - 1)
            buf = io.BytesIO(); self._gen(seed, user_prompt).save(buf, "PNG")
            out.append([seed, buf.getvalue()])
        return out

    @modal.method()
    def gen_scene(self, seed, prompt, neg, depth_png):
        depth = Image.open(io.BytesIO(depth_png)).convert("RGB")
        if DEPTH_FLIP:
            depth = ImageOps.invert(depth)
        img = self._gen(seed, prompt, neg, depth_img=depth)
        buf = io.BytesIO(); img.save(buf, "PNG")
        return buf.getvalue()

    @modal.method()
    def make_depth(self, bg_png):
        res = self._dep()(Image.open(io.BytesIO(bg_png)).convert("RGB"))
        arr = np.array(res["depth"]).astype(np.uint8)
        if DEPTH_FLIP:
            arr = 255 - arr
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, "PNG")
        return buf.getvalue()

    @modal.method()
    def inpaint_floor(self, bg_png, mask_png, seed, strength=0.95):
        g = self.torch.Generator("cuda").manual_seed(seed)
        img = self._inp()(
            prompt="empty open space, smooth polished concrete floor, plain clean background",
            negative_prompt=(NEG + ", objects, clutter, column, columns, pillar, "
                             "pipe, pole, beam, structure, scaffolding, "
                             "shelves, rack, racks, boxes, pallets"),
            image=Image.open(io.BytesIO(bg_png)).convert("RGB"),
            mask_image=Image.open(io.BytesIO(mask_png)).convert("L"),
            width=1024, height=1024, num_inference_steps=24,
            guidance_scale=6.0, strength=strength, generator=g).images[0]
        buf = io.BytesIO(); img.save(buf, "PNG")
        return buf.getvalue()


def tpath(*p): return os.path.join("/assets", *p)

def read_templates():
    assets_vol.reload()
    if not os.path.exists(tpath("templates.json")): return {}
    return json.load(open(tpath("templates.json")))

def save(name, data: bytes):
    os.makedirs(os.path.dirname(tpath(name)), exist_ok=True)
    open(tpath(name), "wb").write(data)
    assets_vol.commit()
    return f"/asset/{name}"


def apply_shadow(bg, plate_img, shadow_png):
    W, H = bg.size
    alpha = Image.open(io.BytesIO(shadow_png)).split()[3].filter(ImageFilter.GaussianBlur(9))
    s3d = np.array(alpha).astype(np.float32) / 255.0
    a = np.array(plate_img.split()[3]) > 8
    rows = np.where(a.any(axis=1))[0]
    y1 = int(rows.max())
    h = y1 - int(rows.min()) + 1
    prof = np.where(a[: y1 + 1].any(axis=0), 255, 0).astype(np.uint8)
    band_h = max(6, int(h * 0.03))
    strip = Image.fromarray(np.tile(prof, (2 * band_h, 1)))
    sh = Image.new("L", (W, H), 0)
    sh.paste(strip, (0, y1 - band_h + 1))
    contact = np.array(sh.filter(ImageFilter.GaussianBlur(band_h))).astype(np.float32) / 255.0
    m = np.clip(0.45 * s3d + 0.12 * contact, 0, 0.5)[..., None]
    arr = np.array(bg).astype(np.float32)
    arr[..., :3] *= (1 - m)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def ring_mask(plate_r, px, py, W, H, grow=50, feather=12):
    obj = Image.new("L", (W, H), 0)
    obj.paste(plate_r.split()[3], (px, py))
    big = obj.filter(ImageFilter.MaxFilter(2 * grow + 1))
    m = np.clip(np.array(big).astype(np.int16) - np.array(obj).astype(np.int16), 0, 255).astype(np.uint8)
    m = Image.fromarray(m).filter(ImageFilter.GaussianBlur(feather))
    m2 = np.clip(np.array(m).astype(np.int16) - np.array(obj).astype(np.int16), 0, 255).astype(np.uint8)
    return Image.fromarray(m2)

@app.function(image=image, volumes={"/assets": assets_vol}, timeout=10 * MIN)
@modal.asgi_app()
def api():
    fast = FastAPI()
    fast.add_middleware(CORSMiddleware, allow_origins=["*"],
                        allow_methods=["*"], allow_headers=["*"])

    @fast.get("/api/health")
    def health(): return {"ok": True}

    @fast.get("/asset/{name:path}")
    def asset(name: str):
        assets_vol.reload()
        p = tpath(name)
        if not os.path.exists(p): raise HTTPException(404)
        return FileResponse(p)

    @fast.post("/api/gen-backgrounds")
    def gen_backgrounds(n: int = Form(4), prompt: str = Form("")):
        out = []
        for seed, png in Model().gen_batch.remote(n=n, user_prompt=prompt):
            name = f"candidates/{uuid.uuid4().hex[:8]}_s{seed}.png"
            out.append({"url": save(name, png), "seed": seed})
        return out

    @fast.get("/api/candidates")
    def candidates():
        d = tpath("candidates")
        return [{"url": f"/asset/candidates/{f}"} for f in sorted(os.listdir(d))] \
            if os.path.exists(d) else []

    @fast.post("/api/make-template")
    async def make_template(file: str = Form(...), tid: str = Form(...)):
        bg_png = open(tpath(file), "rb").read()
        save(f"depth/{tid}.png", Model().make_depth.remote(bg_png))
        t = read_templates()
        old = t.get(tid, {})
        t[tid] = {"bg": file, "depth": f"depth/{tid}.png",
                  "anchor": old.get("anchor", [0.5, 0.85]),
                  "px_per_m": old.get("px_per_m", 110.0)}
        json.dump(t, open(tpath("templates.json"), "w")); assets_vol.commit()
        return t

    @fast.get("/api/templates")
    def templates(): return read_templates()

    @fast.get("/api/calibrate-preview")
    def calibrate(tid: str, ax: float = 0.5, ay: float = 0.85, ppm: float = 110.0,
                  h_mm: float = 1800.0, save_it: int = 0):
        t = read_templates(); tpl = t[tid]
        bg = Image.open(tpath(tpl["bg"])).convert("RGB")
        W, H = bg.size
        hpx = h_mm / 1000.0 * ppm; wpx = 0.6 / 1.0 * ppm * (h_mm / 1800.0)
        d = ImageDraw.Draw(bg, "RGBA")
        d.rectangle([ax * W - wpx / 2, ay * H - hpx, ax * W + wpx / 2, ay * H],
                    fill=(255, 0, 0, 100), outline=(255, 0, 0, 255), width=3)
        if save_it:
            tpl.update(anchor=[ax, ay], px_per_m=ppm)
            json.dump(t, open(tpath("templates.json"), "w")); assets_vol.commit()
        buf = io.BytesIO(); bg.save(buf, "JPEG", quality=90)
        return Response(buf.getvalue(), media_type="image/jpeg")

    @fast.post("/api/compose")
    def compose(plate: UploadFile = File(...), depth: UploadFile = File(...),
                shadow: UploadFile = File(...), params: str = Form("{}")):
        p = json.loads(params)
        seed = int(p["seed"]) if p.get("seed") is not None else random.randint(0, 2**31 - 1)
        t0 = time.time()
        bg = Image.open(io.BytesIO(Model().gen_scene.remote(
            seed=seed, prompt=p.get("prompt", ""), neg=p.get("negative_prompt", ""),
            depth_png=depth.file.read()))).convert("RGB")
        W, H = bg.size
        plate_img = Image.open(io.BytesIO(plate.file.read())).convert("RGBA")
        if not np.any(np.array(plate_img)[:, :, 3] > 8):
            raise HTTPException(400, "render doesn't have alpha-channel")
        db = io.BytesIO(); bg.save(db, "JPEG", quality=85)
        save(f"debug/{seed}_bg.jpg", db.getvalue())

        paste_mask = (plate_img.split()[3]
                      .filter(ImageFilter.MinFilter(3))
                      .filter(ImageFilter.GaussianBlur(0.8)))
        scene = bg.copy(); scene.paste(plate_img, (0, 0), paste_mask)
        out = apply_shadow(scene, plate_img, shadow.file.read())
        buf = io.BytesIO(); out.save(buf, "JPEG", quality=95)
        name = f"results/{uuid.uuid4().hex[:8]}.jpg"
        save(name, buf.getvalue())
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {"url": f"data:image/jpeg;base64,{b64}",
                "seed": seed, "seconds": round(time.time() - t0, 1)}

    return fast