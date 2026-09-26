"""No PostHog project token is committed anywhere in this repo.

History: gitleaks once caught a hardcoded PostHog key in analytics.ts, and the
repo banned token-shaped literals outright (build-time injection only). A later
owner reversal (#1193) briefly committed an in-repo *publishable* default token
(write-only event ingestion, not data access) in
`backend/core/analytics.py` / `frontend/src/utils/analytics.ts`. That default
belonged to the upstream project and was removed for this fork: both files now
resolve their token purely from environment variables
(`SESLY_POSTHOG_KEY` / `POSTHOG_PROJECT_TOKEN` / `VITE_POSTHOG_KEY`), with no
committed fallback. This guard pins the new contract: a `phc_` literal must not
exist anywhere in tracked source. Same file-scanning idiom as
test_no_hardcoded_cjk / test_no_literal_borders.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]

# A PostHog project key. Deliberately matched by SHAPE, not by a specific value,
# so a key can't slip into any file unnoticed.
_POSTHOG_KEY_RE = re.compile(r"phc_[A-Za-z0-9]{20,}")

_SKIP_DIRS = {"node_modules", ".git", "target", "dist", "build", ".venv", "zig-out"}
_SCAN_EXT = {".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".json", ".yml", ".yaml", ".md", ".env"}


def _tracked_files():
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=_REPO, capture_output=True, text=True, check=True
    ).stdout
    for name in (n for n in out.split("\0") if n):
        p = Path(name)
        if any(part in _SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in _SCAN_EXT:
            yield name, _REPO / p


def test_no_posthog_token_literal_anywhere():
    offenders = []
    for name, path in _tracked_files():
        # This guard describes the pattern it forbids, so exempt itself.
        if name == "tests/test_no_committed_analytics_token.py":
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if _POSTHOG_KEY_RE.search(text):
            offenders.append(name)

    assert not offenders, (
        "A PostHog token literal is committed in: "
        + ", ".join(offenders)
        + ". No default ships in-repo; the token comes ONLY from "
        "SESLY_POSTHOG_KEY / POSTHOG_PROJECT_TOKEN (backend) or "
        "VITE_POSTHOG_KEY (frontend build) at build/run time."
    )


# ── the OVERRIDE chain must stay wired ───────────────────────────────────────
#
# There is no in-repo default any more: a build has a destination only when an
# env var supplies one. These pin the links that live in files a future change
# could quietly drop.
#
#     repo secret -> release.yml -> tauri-action -> option_env! in backend.rs
#                 -> spawned backend process env -> analytics._resolved_token()
#
# Every link is invisible when it breaks (events just silently stop).


def test_the_frontend_reads_its_token_from_the_build_env():
    """The build-time token mechanism must stay in place."""
    src = (_REPO / "frontend/src/utils/analytics.ts").read_text(encoding="utf-8")
    assert "VITE_POSTHOG_KEY" in src


def test_release_workflow_still_passes_the_secret_to_the_build():
    wf = (_REPO / ".github/workflows/release.yml").read_text(encoding="utf-8")
    assert "VITE_POSTHOG_KEY" in wf, "the build no longer receives the analytics token"
    assert "secrets.POSTHOG_PROJECT_TOKEN" in wf, "the token must come from the repo secret"


def test_the_shell_hands_the_token_to_the_backend_it_spawns():
    """Without this a baked release token could never reach the backend."""
    src = (_REPO / "frontend/src-tauri/src/backend.rs").read_text(encoding="utf-8")
    assert 'option_env!("VITE_POSTHOG_KEY")' in src, "the shell no longer bakes in the token"
    assert "POSTHOG_PROJECT_TOKEN" in src, "the backend process is no longer given the token"
    # #1193: the shell marks everything it spawns as the "installer" channel.
    assert "OMNIVOICE_INSTALL_CHANNEL" in src, "the shell no longer stamps the install channel"

    # option_env! is resolved at COMPILE time, so cargo must rebuild when the
    # secret changes — otherwise a cached build keeps the token it first saw.
    build_rs = (_REPO / "frontend/src-tauri/build.rs").read_text(encoding="utf-8")
    assert "rerun-if-env-changed=VITE_POSTHOG_KEY" in build_rs
