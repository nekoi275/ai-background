# AI Surrounding for 3D Object

Demo project: AI background generation for 3D models.

## Running

```bash
npm install
npm run dev
```

## Structure

Vanilla TypeScript + Vite, scene rendering with three.js.

- `src/main.ts` — entry point: application state and the generation flow
- `src/api.ts` — client for the backend from `app.py` (base URL: `VITE_API_URL`)
- `src/components/dropzone.ts` — drag-n-drop zone for loading a model (GLB/GLTF)
- `src/components/model-scene.ts` — 3D scene: model loading, orbit camera, angle HUD, plate snapshot
- `src/components/result-modal.ts` — staged result viewer: status → background picker → composed image

## Backend

Generation runs in `app.py` — a FastAPI layer deployed on Modal (SDXL +
ControlNet depth, SDXL inpainting, Depth Anything V2; L4 GPU).

```bash
pip install modal
modal deploy app.py
```

Then copy the printed URL into the frontend config:

```bash
cp .env.example .env.local
# set VITE_API_URL to the URL from `modal deploy`
```

Flow used by the frontend:

1. The 3D viewport is the generation template: the app renders two
   aligned 1024×1024 images from the camera — the model on transparency
   (plate) and a depth pass (ground plane + room corner, near = bright)
2. `POST /api/compose` (plate, depth, params JSON with `prompt`,
   `negative_prompt` and an optional `seed`) → SDXL + depth ControlNet
   paints the scene onto that geometry, the plate is pasted 1:1 in the
   same pixels, a contour contact shadow is added. No inpainting —
   product pixels stay untouched.

Prompts (positive and negative) live in the panel with the previous
defaults pre-filled; the constants in app.py are only a fallback when the
request carries empty values. The "Scene" section controls the room
corner: checkbox + distance — how close the product stands to the walls.

The camera angle and framing define the background's perspective and the
model's placement/scale; the seed varies the look. `gen-backgrounds`,
`make-template`, `calibrate-preview` remain as manual curl tools but are
no longer part of the UI flow.

Flow in the UI: load a model → frame it with the camera (the framing is
the shot) → optional prompt → “Generate background”.

## Manual testing (curl)

```bash
API=https://<workspace>--poc-bg-api.modal.run

curl -X POST "$API/api/gen-backgrounds" -F n=4 -F prompt=""
# → [{"url": "/asset/candidates/…", "seed": …}, …] — open $API + url in a browser

# plate.png / depth.png can be taken from the browser devtools network tab
# (the compose request the UI sends) or produced with three.js the same way
curl -X POST "$API/api/compose" -F "plate=@plate.png" -F "depth=@depth.png" \
  -F 'params={"prompt":"","seed":123}'
```

