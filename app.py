
import modal

from backend import Model as ModelCls, RecoveryStorage, create_app
from backend.config import IMAGE_ENV

MIN = 60

app = modal.App("ai-background")

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.1",
        "diffusers==0.31.0",
        "transformers==4.45.2",
        "accelerate==1.0.1",
        "safetensors",
        "fastapi",
        "python-multipart",
        "pillow",
        "numpy",
        "hf_transfer",
    )
    .env(IMAGE_ENV)
    .add_local_python_source("backend")
)

api_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi",
        "python-multipart",
        "pillow",
        "numpy",
        "rembg[cpu]>=2.0.57",
    )
    .env(IMAGE_ENV)
    .add_local_python_source("backend")
)

hf_vol = modal.Volume.from_name("hf-cache", create_if_missing=True)
kv = modal.Dict.from_name("ai-background-recovery", create_if_missing=True)
storage = RecoveryStorage(kv)

Model = app.cls(
    image=gpu_image,
    gpu="L4",
    timeout=20 * MIN,
    scaledown_window=60,
    volumes={"/cache": hf_vol},
    memory=16384,
    enable_memory_snapshot=True,
)(ModelCls)


@app.function(
    image=api_image,
    cpu=2,
    memory=4096,
    timeout=10 * MIN,
    volumes={"/cache": hf_vol},
    secrets=[modal.Secret.from_name("ai-background")],
)
@modal.asgi_app()
def api():
    return create_app(storage=storage, model_factory=Model)
