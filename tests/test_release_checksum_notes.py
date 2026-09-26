"""Release notes and publishing have one writer, after every platform has built.

Every build leg used to append its checksums to the shared release notes with
softprops/action-gh-release. The concurrent read-modify-writes lost a section
(the macOS Apple Silicon one, in both v0.5.1 and v0.5.2), and softprops'
default draft: false published the draft when the FIRST leg finished, before
the other installers and the complete latest.json were attached.
"""
import re
from pathlib import Path

WORKFLOW = (Path(__file__).resolve().parents[1] / ".github/workflows/release.yml").read_text(
    encoding="utf-8"
)


def _job(name: str) -> str:
    """The text of one top-level job, up to the next job."""
    start = WORKFLOW.index(f"\n  {name}:\n")
    nxt = re.search(r"\n  [a-z0-9_-]+:\n", WORKFLOW[start + 1:])
    return WORKFLOW[start: start + 1 + nxt.start()] if nxt else WORKFLOW[start:]


def _code(text: str) -> str:
    """Without YAML comment lines: an explanation may name what it replaced."""
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def _matrix_labels() -> list[str]:
    return re.findall(r'^\s+label: "([^"]+)"$', _job("build"), flags=re.M)


def test_no_build_leg_writes_the_notes_or_publishes():
    build = _code(_job("build"))
    assert "softprops/action-gh-release" not in build
    assert "append_body" not in build
    assert "--draft=false" not in build


def test_one_job_writes_every_platforms_checksums_in_matrix_order():
    job = _job("release-notes-checksums")
    assert "needs: [build, repair-updater-manifest, uninstall-scripts]" in job
    labels = _matrix_labels()
    assert labels, "the build matrix no longer declares platform labels"
    positions = [job.index(f'"{label}"') for label in labels]
    assert positions == sorted(positions), "sections must follow the matrix order"


def test_only_that_job_publishes():
    job = _code(_job("release-notes-checksums"))
    assert job.count("--draft=false") >= 1
    assert _code(WORKFLOW).count("--draft=false") == job.count("--draft=false")


def test_the_contributors_strip_edits_the_notes_after_them():
    assert "needs: [build, release-notes-checksums]" in _job("contributors-strip")


def test_a_missing_platform_stops_before_the_notes_or_the_publish():
    """A release missing one platform's checksums must stay a draft: the job
    exits before it rewrites the notes or publishes anything."""
    job = _code(_job("release-notes-checksums"))
    assert "missing=1" in job
    gate = job.index('[ "$missing" = 0 ] || exit 1')
    assert gate < job.index("--notes-file") < job.index("--draft=false")
