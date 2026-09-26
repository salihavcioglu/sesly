from pathlib import Path

from api.routers.setup.download import _create_cache_pointer


def test_segmented_cache_pointer_preserves_the_canonical_blob(tmp_path: Path):
    blob = tmp_path / "blobs" / "model-hash"
    pointer = tmp_path / "snapshots" / "revision" / "model.safetensors"
    blob.parent.mkdir(parents=True)
    pointer.parent.mkdir(parents=True)
    blob.write_bytes(b"model-weights")

    _create_cache_pointer(str(blob), str(pointer))

    assert blob.read_bytes() == b"model-weights"
    assert pointer.read_bytes() == b"model-weights"
