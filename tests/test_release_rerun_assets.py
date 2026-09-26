"""Release retries retain other targets, versions, and updater manifests."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

@pytest.fixture
def module():
    spec = importlib.util.spec_from_file_location(
        "rerun_assets", Path(__file__).parents[1] / "scripts/clear-release-rerun-assets.py"
    )
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    return runtime

@pytest.mark.parametrize("target,suffix", [
    ("x86_64-pc-windows-msvc", "x64_en-US.msi"),
    ("aarch64-apple-darwin", "aarch64.dmg"),
    ("x86_64-apple-darwin", "x64.dmg"),
    ("x86_64-unknown-linux-gnu", "amd64.AppImage"),
])
def test_retry_selects_only_its_own_installers(module, target, suffix):
    own = f"Sesly_0.5.2-150_{suffix}"
    others = ["latest.json", "Sesly_universal.app.tar.gz", "Sesly_0.5.2-149_" + suffix,
              "Sesly_Current_User_0.5.2-150_x64_en-US.msi", "Other_0.5.2-150_" + suffix]
    assert module.matching_assets([*others, own, own + ".sig"], "0.5.2-150", target) == [own, own + ".sig"]


def test_windows_retry_does_not_touch_mac_x64_dmg(module):
    assert module.matching_assets(["Sesly_0.5.2-150_x64.dmg", "Sesly_0.5.2.150_x64_en-US.msi"],
                                 "0.5.2-150", "x86_64-pc-windows-msvc") == ["Sesly_0.5.2.150_x64_en-US.msi"]

@pytest.mark.parametrize("error", ["HTTP 403", "HTTP 429", "network failure"])
def test_failed_inventory_cannot_silently_continue(module, monkeypatch, error):
    monkeypatch.setattr(module.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stderr=error))
    with pytest.raises(RuntimeError, match=error):
        module.clear_assets("preview", "0.5.2-150", "x86_64-pc-windows-msvc")


def test_retry_step_runs_before_tauri_upload():
    text = (Path(__file__).parents[1] / ".github/workflows/release.yml").read_text()
    start = text.index("- name: Clear this target's installer assets on retry")
    end = text.index("- name: Build + release (Tauri)")
    assert start < end
    assert "if: github.run_attempt > 1" in text[start:end]
    assert "scripts/clear-release-rerun-assets.py" in text[start:end]


@pytest.mark.parametrize("target,arch,sibling", [
    ("aarch64-apple-darwin", "aarch64", "x64"),
    ("x86_64-apple-darwin", "x64", "aarch64"),
])
def test_macos_retry_clears_only_its_versionless_updater(module, target, arch, sibling):
    own = f"Sesly_{arch}.app.tar.gz"
    names = [own, own + ".sig", f"Sesly_{sibling}.app.tar.gz", "latest.json"]
    assert module.matching_assets(names, "0.5.2", target) == [own, own + ".sig"]


def test_deletion_invocation_keeps_nonmatching_assets(module, monkeypatch):
    own = "Sesly_0.5.2-150_x64_en-US.msi"
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        assert kwargs == {"capture_output": True, "text": True}
        if args[2] == "view":
            return SimpleNamespace(returncode=0, stdout=module.json.dumps({"assets": [
                {"name": own}, {"name": own + ".sig"}, {"name": "latest.json"},
                {"name": "Sesly_0.5.2-149_x64_en-US.msi"},
            ]}), stderr="")
        return SimpleNamespace(returncode=0, stderr="")
    monkeypatch.setattr(module.subprocess, "run", run)
    module.clear_assets("preview", "0.5.2-150", "x86_64-pc-windows-msvc")
    assert calls == [
        ["gh", "release", "view", "preview", "--json", "assets"],
        ["gh", "release", "delete-asset", "preview", own, "--yes"],
        ["gh", "release", "delete-asset", "preview", own + ".sig", "--yes"],
    ]


@pytest.mark.parametrize("error", ["HTTP 403", "HTTP 429", "network failure"])
def test_deletion_failure_stops_retry(module, monkeypatch, error):
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if args[2] == "view":
            return SimpleNamespace(returncode=0, stdout=module.json.dumps({"assets": [
                {"name": "Sesly_0.5.2_x64_en-US.msi"},
                {"name": "Sesly_0.5.2_x64_en-US.msi.sig"},
            ]}), stderr="")
        return SimpleNamespace(returncode=1, stderr=error)
    monkeypatch.setattr(module.subprocess, "run", run)
    with pytest.raises(RuntimeError, match=error):
        module.clear_assets("v0.5.2", "0.5.2", "x86_64-pc-windows-msvc")
    assert len(calls) == 2


@pytest.mark.parametrize("error", ["HTTP 404", "release not found"])
def test_absent_release_needs_no_deletion(module, monkeypatch, error):
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=1, stderr=error)
    monkeypatch.setattr(module.subprocess, "run", run)
    module.clear_assets("preview", "0.5.2-150", "x86_64-pc-windows-msvc")
    assert len(calls) == 1


def test_concurrent_missing_asset_is_benign(module, monkeypatch):
    def run(args, **kwargs):
        if args[2] == "view":
            return SimpleNamespace(returncode=0, stdout='{"assets":[{"name":"Sesly_0.5.2_x64_en-US.msi"}]}')
        return SimpleNamespace(returncode=1, stderr="HTTP 404")
    monkeypatch.setattr(module.subprocess, "run", run)
    module.clear_assets("v0.5.2", "0.5.2", "x86_64-pc-windows-msvc")


def test_cleanup_uses_stamped_package_version():
    text = (Path(__file__).parents[1] / ".github/workflows/release.yml").read_text()
    stamp = text.index("- name: Stamp preview version")
    clear = text.index("- name: Clear this target's installer assets on retry")
    build = text.index("- name: Build + release (Tauri)")
    assert stamp < clear < build
    assert 'frontend/package.json' in text[clear:build]
    assert '--version "$VERSION"' in text[clear:build]
    assert "github.run_number" not in text[clear:build]


def test_stable_floor_stamp_selects_new_patch_not_source_package_version(module, tmp_path):
    import json
    import subprocess
    import sys

    package = tmp_path / "package.json"
    package.write_text(json.dumps({"version": "0.5.2"}))
    script = Path(__file__).parents[1] / "scripts/stamp-preview-version.py"
    subprocess.run([
        sys.executable, str(script), "--package-json", str(package),
        "--stable-tag", "v0.5.2", "--run-number", "150",
    ], check=True, capture_output=True, text=True)
    version = json.loads(package.read_text())["version"]
    assert version == "0.5.3-150"
    names = ["Sesly_0.5.2-150_x64_en-US.msi", "Sesly_0.5.3-150_x64_en-US.msi"]
    assert module.matching_assets(names, version, "x86_64-pc-windows-msvc") == [names[1]]
