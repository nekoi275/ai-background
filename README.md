# AI Background

Product photos **and** 3D models on AI-generated backgrounds.

## How it works

A 4-step wizard with two generation flows. Photos skip the 3D scene
entirely and go straight to the model; 3D models are framed in an editable
box-room, and what you frame is exactly what generation receives. Both
flows end in the same single-image edit pass (Qwen-Image-Edit-2511, cfg 4)
whose instruction preserves the product exactly — shape, proportions,
materials, artwork, branding — while the prompt decides the scene.

Every product carries a **placement**: `floor` (default — stands on the
floor or a table), `wall` / `ceiling` (mounted flush, positioned in the
studio), or `cover` (the product is a surface material — tile, parquet —
instanced across the selected walls/floor/ceiling; the scene may then
build over it: cabinets, furniture). The placement picks the instruction
template on the backend; the blockout render remains the spatial ground
truth in the 3D flow.

1. **Product.** Drop a photo (JPG/PNG/WebP) or a 3D model (GLB/GLTF/OBJ/FBX).
   Photos without transparency are keyed out client-side (chroma-key); if
   the edges look off, one click re-runs the cutout with AI (`POST
   /api/cutout`, rembg). PNGs with real alpha are trimmed client-side.
   3D models keep their native size in meters. Pick the placement here.
2. **Scene** (3D models only). A light box-room with adjustable
   width/height/depth and an optional table pedestal — box or cylinder,
   with independent width/depth/height — that the product stands on when
   visible. Orbit the camera to set the shot. The room renders neutrally
   with real shadows and a directed key light, so geometry and lighting
   come from the render while surface materials stay the prompt's job.
3. **Prompt.** Describe the scene. Photos post the background-free cutout
   to `POST /api/generate-photo` (square 1024×1024 output). 3D models post
   the framed render plus a close-up product reference to `POST
   /api/generate`: a single multi-image edit pass turns the render into a
   photoreal photograph of the described scene while the reference image
   anchors the product's appearance down to the smallest part.
4. **Result.** Jobs are spawned and polled via `/api/result/{seed}`;
   failures fail loudly. Download or generate a new variation (new seed).

Uploads are normalized to PNG in a canvas (EXIF orientation applied,
transparency preserved, capped at 1536 px).

## Running locally

The client always calls same-origin `/api/*`. In dev, the vite dev server
proxies those to the Modal backend and injects the token server-side
(`vite.config.ts`) — the token never enters the client bundle. Put the
backend URL and the token in `.env.local` (see `.env.example`), then:

```bash
npm install
npm run dev
```

## Backend

Generation runs in `app.py` — a FastAPI layer deployed on Modal with a
single GPU container hosting Qwen-Image-Edit-2511 (memory ladder: full-GPU
resident on ≥60 GB cards, then group offload, then CPU offload). The photo
flow spawns `image_to_photo` (single image); the 3D flow spawns
`render_to_photo` (scene render + close-up product reference, both client
renders). One deterministic recipe (`GEN_EDIT_MODEL`, `GEN_EDIT_STEPS`,
`GEN_EDIT_GUIDANCE`, fixed negative prompt) with the instruction templates
`PHOTO_INSTRUCTION` / `RENDER_INSTRUCTION` and their `MOUNTED_*` / `COVER_*`
variants (selected by the request's `placement`) in `backend/config.py`. There
are no fallbacks: if generation fails, the request fails loudly.

Every endpoint (except `/api/health`) requires the bearer token from the
Modal secret **`ai-background`** (`API_TOKEN` inside it):

```bash
modal secret create ai-background API_TOKEN=<random-string>
pip install modal
modal deploy app.py
```

Note: the token only exists server-side (Modal secret, Worker secret, vite
dev proxy) — it never reaches the browser or the client bundle.

Recovery: results are stashed in a Modal Dict; if the proxy severs a long
request, the frontend polls `/api/result/{seed}` instead of losing the
generation.

## Frontend deploy (Cloudflare Workers)

```bash
wrangler secret put API_TOKEN   # once: same value as the Modal secret
npm run deploy                  # = vite build + wrangler deploy
```

→ <https://ai-background.nekoi275.workers.dev>

The Worker (`worker/index.js`) serves the static bundle and proxies
`/api/*` to the Modal backend, injecting `Authorization` from its own
`API_TOKEN` secret — the browser never sees the token. The backend URL
lives in `vars.MODAL_API_URL` in `wrangler.jsonc`, so changing it does
not require a rebuild.

The workers.dev URL itself is still public: anyone who knows it can ask
the Worker to run generations. To gate that too, enable Cloudflare
Access on the Worker (Zero Trust → Access → self-hosted app on the
workers.dev domain) — visitors then sign in with email before reaching
anything, including `/api/*`.

## Structure

Vanilla TypeScript + Vite, room rendering with three.js.

- `app.py` — Modal deployment entrypoint
- `backend/` — backend pipeline package (api, cutout, depth, models, storage, config)
- `src/main.ts` — 4-step wizard state machine + generation flow
- `src/api.ts` — same-origin client for the backend endpoints from `app.py`
- `vite.config.ts` — dev proxy: /api/* → Modal with the token injected
- `worker/index.js` — Cloudflare Worker: static assets + token-injecting
  /api/* proxy for production
- `src/components/studio/` — 3D studio package: room box, table, 3D model
  product with shadows, orbit camera, snapshot capture pass
- `src/components/dropzone.ts` — drag & drop visuals for product files
- `src/components/model-loader.ts` — GLB/GLTF/OBJ/FBX → centered object
- `src/components/result-view.ts` — step-4 panel (status/result/error)
- `src/lib/file-type.ts` — image vs 3D-model detection (extension + magic)
- `src/lib/chroma-key.ts` — client-side background keying (border color + flood fill)
- `src/lib/image.ts` — PNG normalization, alpha checks, chroma-key → AI cutout flow
- `src/lib/encode.ts` — base64/data-URL ↔ Blob helpers

## Manual testing (curl)

```bash
API=https://<workspace>--ai-background-api.modal.run
TOKEN=<API_TOKEN from the Modal secret "ai-background">

# 3D model flow: render.png — the framed neutral render from the studio,
# product-ref.png — the close-up product shot on neutral gray
curl -X POST "$API/api/generate" -H "Authorization: Bearer $TOKEN" \
  -F 'params={"seed":123,"width":1024,"height":1024,"prompt":"spacious gallery interior, bright daylight"}' \
  -F "render=@render.png" -F "product_ref=@product-ref.png"
# → {"seed":123,"queued":true} — then poll until ready:
curl "$API/api/result/123" -H "Authorization: Bearer $TOKEN"
# → {"image_b64": …} (404 while running, 500 with the error on failure)

# photo flow: product.png — the background-free cutout
curl -X POST "$API/api/generate-photo" -H "Authorization: Bearer $TOKEN" \
  -F 'params={"seed":123,"width":1024,"height":1024,"prompt":"sunset terrace overlooking the sea"}' \
  -F "product=@cutout.png"
# → {"seed":123,"queued":true} — poll the same way

# photo → trimmed RGBA cutout PNG
curl -X POST "$API/api/cutout" -H "Authorization: Bearer $TOKEN" \
  -F "image=@product.jpg" -o cutout.png
```
