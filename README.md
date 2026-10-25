# AI Background

Product photos **and** 3D models on AI-generated backgrounds, framed by a
configurable 3D box-room.

## How it works

A 4-step wizard. The product — a photo or a 3D model — always lives inside
the 3D scene, so what you frame in the editor is exactly what generation
receives.

1. **Product.** Drop a photo (JPG/PNG/WebP) or a 3D model (GLB/GLTF/OBJ/FBX).
   Photos without transparency are cut out via `POST /api/cutout` (rembg;
   PNGs with real alpha are trimmed client-side). 3D models keep their
   native size in meters.
2. **Scene.** A light box-room with adjustable width/height/depth, an
   optional table cube (the product stands on it when visible), and — for
   photos — an object-height slider. Orbit the camera inside the room to
   set the shot; the viewport is square, matching the output frame.
3. **Prompt.** Describe the background (plus a negative prompt). The
   frontend renders a depth pass of room + table + product (bright =
   closer, range adapted to the room) and posts it with the prompt to
   `POST /api/scene`: SDXL + ControlNet-Depth paints the interior locked
   to that geometry — the backend only appends a geometry-anchoring base
   (`GEOMETRY_BASE` in `app.py`).
4. **Result.** `POST /api/compose` receives the client-rendered product
   plate — the product alone on a transparent background, native
   proportions, framed by the user's camera — pasted 1:1, grounded with a
   contact shadow and blended with depth-of-field + unified grain.
   Download or generate a new variation (new seed).

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

Generation runs in `app.py` — a FastAPI layer deployed on Modal
(SDXL + ControlNet-Depth, Depth-Anything V2 for DoF, rembg for cutout;
L4 GPU for scene generation, CPU for cutout/compose).

Every endpoint (except `/api/health`) requires the bearer token from the
Modal secret **`ai-background`** (`API_TOKEN` inside it):

```bash
modal secret create ai-background API_TOKEN=<random-string>
pip install modal
modal deploy app.py
```

Note: the token only exists server-side (Modal secret, Worker secret, vite
dev proxy) — it never reaches the browser or the client bundle.

Recovery: the scene stage stashes its result in a Modal Dict; if the proxy
severs a long request, the frontend polls `/api/scene-result/{seed}`
instead of losing the generation.

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

- `src/main.ts` — 4-step wizard state machine + generation flow
- `src/api.ts` — same-origin client for the backend endpoints from `app.py`
- `vite.config.ts` — dev proxy: /api/* → Modal with the token injected
- `worker/index.js` — Cloudflare Worker: static assets + token-injecting
  /api/* proxy for production
- `src/components/dropzone.ts` — drag & drop visuals for product files
- `src/components/model-loader.ts` — GLB/GLTF/OBJ/FBX → centered object
- `src/components/studio-scene.ts` — the 3D studio: room box, table,
  product (billboard or model), orbit camera, depth/plate/snapshot capture
- `src/components/result-view.ts` — step-4 panel (status/result/error)
- `src/lib/file-type.ts` — image vs 3D-model detection (extension + magic)
- `src/lib/image.ts` — PNG normalization, alpha checks, cutout trimming
- `src/lib/encode.ts` — base64/data-URL ↔ Blob helpers

## Manual testing (curl)

```bash
API=https://<workspace>--ai-background-api.modal.run
TOKEN=<API_TOKEN from the Modal secret "ai-background">

# depth.png: any 8-bit grayscale image, bright = closer (from the browser
# devtools network tab, or rendered with three.js the same way)
curl -X POST "$API/api/scene" -H "Authorization: Bearer $TOKEN" \
  -F 'params={"seed":123,"width":1024,"height":1024,"prompt":"spacious gallery interior, bright daylight"}' \
  -F "depth=@depth.png"
# → {"scene_b64": …, "depth_b64": …} — decode both to files

# plate.png: full-frame RGBA product render (transparent background)
curl -X POST "$API/api/compose" -H "Authorization: Bearer $TOKEN" \
  -F "plate=@plate.png" -F "scene=@scene.jpg" \
  -F "depth=@depth16.png" -F 'params={"seed":123}'
# → {"image_b64": …}

# photo → trimmed RGBA cutout PNG
curl -X POST "$API/api/cutout" -H "Authorization: Bearer $TOKEN" \
  -F "image=@product.jpg" -o cutout.png
```
