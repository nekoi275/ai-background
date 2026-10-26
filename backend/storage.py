from typing import Any, Protocol
from .config import KV_KEEP_SEEDS


class KVStoreProtocol(Protocol):
    def get(self, key: str, default: Any = None) -> Any:
        ...

    def put(self, key: str, value: Any) -> None:
        ...

    def pop(self, key: str, default: Any = None) -> Any:
        ...


class RecoveryStorage:
    """Manages chunked storage in a Modal Dict or compatible key-value store,
    allowing retrieval of large responses and pruning historical seeds."""

    def __init__(self, store: Any, keep_seeds: int = KV_KEEP_SEEDS):
        self.store = store
        self.keep_seeds = keep_seeds

    def put_chunks(self, key: str, data: bytes, chunk: int = 400_000) -> None:
        parts = max(1, (len(data) + chunk - 1) // chunk)
        for i in range(parts):
            self.store.put(f"{key}#{i}", data[i * chunk : (i + 1) * chunk])
        self.store.put(f"{key}#n", parts)

    def get_chunks(self, key: str) -> bytes:
        parts = self.store.get(f"{key}#n")
        if parts is None:
            raise KeyError(key)
        parts = int(parts)
        chunks = []
        for i in range(parts):
            value = self.store.get(f"{key}#{i}")
            if value is None:
                raise KeyError(key)
            chunks.append(value)
        return b"".join(chunks)

    def forget_seed(self, seed: int) -> None:
        for prefix in ("scene_", "last_"):
            key = f"{prefix}{seed}"
            parts = self.store.get(f"{key}#n")
            if parts is None:
                continue
            for i in range(int(parts)):
                self.store.pop(f"{key}#{i}", None)
            self.store.pop(f"{key}#n", None)

    def track_seed(self, seed: int) -> None:
        """Keep only the newest `keep_seeds` stashed results (the recovery Dict
        has no TTL; without this it grows forever). Best-effort: pruning must
        never fail a generation."""
        try:
            recent = self.store.get("recent")
            if not isinstance(recent, list):
                recent = []
            if seed in recent:
                recent.remove(seed)
            recent.append(seed)
            while len(recent) > self.keep_seeds:
                self.forget_seed(int(recent.pop(0)))
            self.store.put("recent", recent)
        except Exception:
            pass
