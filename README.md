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

1. If a calibrated template exists (`GET /api/templates`; the most recent
   one wins), “Generate” composes straight away
2. Otherwise: `POST /api/gen-backgrounds` → user picks one →
   `POST /api/make-template` → compose
3. `POST /api/compose` (model plate PNG with alpha, params JSON with
   `template_id`, `height_mm`, `prompt`, optional `seed`) → final image.
   The scene is regenerated from the template's depth map on every call —
   the layout stays fixed, the look is new each time. `seed` makes it
   reproducible.

Flow in the UI: load a model → set the camera angle in the viewport → describe
the surroundings (optional) → “Generate background” → pick a background → get
the composed scene.

## Manual testing (curl)

```bash
API=https://<workspace>--poc-bg-api.modal.run

curl -X POST "$API/api/gen-backgrounds" -F n=4 -F prompt=""
# → [{"url": "/asset/candidates/…", "seed": …}, …] — open $API + url in a browser

curl -X POST "$API/api/make-template" -F "file=candidates/<name>.png" -F "tid=tpl-1"

curl -X POST "$API/api/compose" -F "plate=@plate.png" \
  -F 'params={"template_id":"tpl-1","height_mm":600,"prompt":""}'
```

`plate.png` is the model rendered on a transparent background — the frontend
produces it automatically (`capturePlate()` in model-scene.ts).

