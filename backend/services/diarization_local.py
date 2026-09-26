"""Resolve the installed pyannote bundle without network access at job time."""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory


@contextmanager
def local_pipeline_config():
    import yaml
    from huggingface_hub import hf_hub_download
    from huggingface_hub.constants import HF_HUB_CACHE
    from services.hf_revisions import installed_revision

    def cached(repo: str, filename: str) -> str:
        return hf_hub_download(
            repo_id=repo,
            filename=filename,
            revision=installed_revision(repo, HF_HUB_CACHE),
            local_files_only=True,
        )

    config_path = cached("pyannote/speaker-diarization-3.1", "config.yaml")
    config = yaml.safe_load(Path(config_path).read_text(encoding="utf-8"))
    params = config["pipeline"]["params"]
    # The reviewed pipeline references these two checkpoints. Local checkpoint
    # paths prevent pyannote's nested Model.from_pretrained calls fetching them.
    for key, repo in (
        ("segmentation", "pyannote/segmentation-3.0"),
        ("embedding", "pyannote/wespeaker-voxceleb-resnet34-LM"),
    ):
        if params.get(key) != repo:
            raise ValueError(f"Unexpected diarisation {key} repository; repair the installed pipeline")
        params[key] = cached(repo, "pytorch_model.bin")
    with TemporaryDirectory(prefix="sesly-pyannote-") as directory:
        path = Path(directory) / "config.yaml"
        path.write_text(yaml.safe_dump(config), encoding="utf-8")
        yield str(path)
