# AI Surrounding for 3D Object

Demo project: AI background generation for 3D models.

## Running

```bash
npm install
npm run dev
```

## Structure

Vanilla TypeScript + Vite, scene rendering with three.js.

- `src/main.ts` — entry point: application state and component wiring
- `src/components/dropzone.ts` — drag-n-drop zone for loading a model (GLB/GLTF)
- `src/components/model-scene.ts` — 3D scene: model loading, orbit camera, angle HUD
- `src/components/result-modal.ts` — generation result viewer

Flow: load a model → set the camera angle in the viewport → describe the
surroundings in the prompt → “Generate background”. The backend integration
point is `handleGenerate()` in `src/main.ts`.
