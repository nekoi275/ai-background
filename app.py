
import modal

from backend import Harmonizer as HarmonizerCls, Model as ModelCls, RecoveryStorage, create_app
from backend.config import IMAGE_ENV, get_edit_gpu_config, get_gpu_config

MIN = 60

app = modal.App("ai-background")

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.15.0",
        "torchvision",
        "diffusers==0.42.1",
        "transformers==5.22.2",
        "accelerate==1.15.0",
        "sentencepiece",
        "protobuf",
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
    gpu=get_gpu_config(),
    timeout=20 * MIN,
    scaledown_window=60,
    volumes={"/cache": hf_vol},
    memory=32768,
    enable_memory_snapshot=True,
)(ModelCls)

Harmonizer = app.cls(
    image=gpu_image,
    gpu=get_edit_gpu_config(),
    timeout=30 * MIN,
    scaledown_window=60,
    volumes={"/cache": hf_vol},
    memory=98304,
)(HarmonizerCls)


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
    return create_app(
        storage=storage, model_factory=Model, harmonizer_factory=Harmonizer
    )
