# AI Background

Product photos **and** 3D models on AI-generated backgrounds, framed by a
configurable 3D box-room.

## How it works

A 4-step wizard. The product — a photo or a 3D model — always lives inside
the 3D scene, so what you frame in the editor is exactly what generation
receives.

1. **Product.** Drop a photo (JPG/PNG/WebP) or a 3D model (GLB/GLTF/OBJ/FBX).
   Photos without transparency are keyed out client-side (chroma-key); if
   the edges look off, one click re-runs the cutout with AI (`POST
   /api/cutout`, rembg). PNGs with real alpha are trimmed client-side.
   3D models keep their native size in meters.
2. **Scene.** A light box-room with adjustable width/height/depth, an
   optional table pedestal — box or cylinder, with independent
   width/depth/height — (the product stands on it when visible), a
   glossy-surface toggle (reflection under the product; shadows are kept
   either way), and — for photos — an object-height slider. Orbit the
   camera inside the room to set the shot; the viewport is square,
   matching the output frame.
3. **Prompt.** Describe the background (plus a negative prompt — inert at
   CFG=1, which is the Turbo default; it only activates via
   `GEN_GUIDANCE > 1`). The frontend renders a depth pass of room + table
   (bright = closer, range adapted to the room; the product is hidden) and
   posts it with the prompt plus the table facts (visible, box or
   cylinder) to `POST /api/scene`: Qwen-Image-2.1-Turbo treats the depth
   map as a reference image — it conditions softly, it does not enforce
   geometry — so the backend appends a base (`geometry_base` in
   `backend/config.py`) that explains the depth map, claims every
   silhouette in it (including the table block, described as round for
   cylinders) and leaves the floor phrase to follow the glossy toggle.
4. **Result.** `POST /api/compose` receives the client-rendered product
   plate — the product alone on a transparent background, native
   proportions, framed by the user's camera — and runs two stages.
   First a pixel-space composite: the plate pasted 1:1 over a procedural
   contact shadow, blended with depth-of-field. Then a generative
   harmonization pass on a masked inpaint pipeline (Qwen-Image-Edit-2511,
   strength 1.0, 24 steps, cfg 4): a mask built from the plate covers the
   product and the ground zone under it, so the background is frozen by
   construction while the pass relights the product and adds surface
   effects (a reflection when the glossy toggle is on); afterwards the
   product region is blended 55/45 back toward the original plate so the
   material and colors cannot drift, and the instruction forbids altering
   the product itself. The pass is spawned and polled via
   `/api/result/{seed}`; failures fail loudly. Download or generate a new
   variation (new seed).

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
(Qwen-Image-2.1-Turbo for fast 8-step depth-conditioned scene generation and
native RGBA cutout, Depth-Anything V2 for DoF, and a separate `Harmonizer`
container with Qwen-Image-Edit-2511 for the compose-time relight). The scene
GPU chain is `L40S` -> `A100` -> `L4` -> `A10` (`MODAL_GPU` overrides); the
Harmonizer defaults to `A100-80GB` first — resident weights make a
full-quality pass ~2 min GPU, cheaper per run than streamed inference on
smaller cards (`MODAL_EDIT_GPU` overrides).

Compose is two-phase: `POST /api/compose` runs the pixel-space composite and
spawns the harmonize job, returning `{seed, queued}` immediately; `GET
/api/result/{seed}` polls until the JPEG is ready or a stored error
surfaces as a 500. Harmonization always runs one full-quality recipe
(env-tunable: `GEN_EDIT_MODEL`, `GEN_EDIT_STEPS` = 40, `GEN_EDIT_GUIDANCE`
= 4.0 with a fixed negative prompt) and the same deterministic instruction
(`EDIT_INSTRUCTION` in `backend/config.py`) — user prompts are never
forwarded to it. There are no fallbacks: if harmonization fails, the
request fails loudly with the error.

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

- `app.py` — Modal deployment entrypoint
- `backend/` — backend pipeline package (api, compositing, cutout, depth, models, storage, config)
- `src/main.ts` — 4-step wizard state machine + generation flow
- `src/api.ts` — same-origin client for the backend endpoints from `app.py`
- `vite.config.ts` — dev proxy: /api/* → Modal with the token injected
- `worker/index.js` — Cloudflare Worker: static assets + token-injecting
  /api/* proxy for production
- `src/components/studio/` — 3D studio package: room box, table,
  product (billboard or model), orbit camera, depth/plate/snapshot capture passes
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
# → {"seed":123,"queued":true} — then poll until ready:
curl "$API/api/result/123" -H "Authorization: Bearer $TOKEN"
# → {"image_b64": …} (404 while running, 500 with the error on failure)

# photo → trimmed RGBA cutout PNG
curl -X POST "$API/api/cutout" -H "Authorization: Bearer $TOKEN" \
  -F "image=@product.jpg" -o cutout.png
```
