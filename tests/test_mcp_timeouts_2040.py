"""#2040 — the MCP tools gave up after a fixed 120 s while the backend's own
budgets run longer (ASR: 300 s), so a request the backend would have finished
came back as an empty client-side timeout."""
import pytest

_BUDGET_VARS = (
    "OMNIVOICE_MCP_TIMEOUT_S",
    "OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S",
    "OMNIVOICE_GENERATE_TIMEOUT_S",
    "OMNIVOICE_CPU_GENERATE_TIMEOUT_S",
    "OMNIVOICE_GPU_QUEUE_TIMEOUT_S",
)
QUEUE = 1800.0
GRACE = 30.0


@pytest.fixture
def post_timeout(monkeypatch):
    for name in _BUDGET_VARS:
        monkeypatch.setenv(name, "1")  # recorded, so the teardown restores it
        monkeypatch.delenv(name)
    import mcp_server

    return mcp_server._post_timeout_s


def test_transcribe_waits_past_the_backends_asr_budget(post_timeout):
    assert post_timeout("transcribe") == 300.0 + GRACE


def test_a_raised_asr_budget_is_followed(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", "900")
    assert post_timeout("transcribe") == 900.0 + GRACE


def test_generation_covers_the_queue_and_the_length_scaled_budget(post_timeout):
    assert post_timeout("generate", "short") == QUEUE + 600.0 + GRACE
    assert post_timeout("generate", "x" * 1600) == QUEUE + 610.0 + GRACE


def test_the_larger_cpu_generation_budget_wins(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_CPU_GENERATE_TIMEOUT_S", "900")
    assert post_timeout("generate", "short") == QUEUE + 900.0 + GRACE


def test_a_raised_gpu_generation_budget_wins_when_larger(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_GENERATE_TIMEOUT_S", "1200")
    assert post_timeout("generate", "short") == QUEUE + 1200.0 + GRACE


def test_a_shorter_queue_budget_is_followed(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_GPU_QUEUE_TIMEOUT_S", "60")
    assert post_timeout("generate", "short") == 60.0 + 600.0 + GRACE


def test_an_explicit_mcp_timeout_still_wins(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_MCP_TIMEOUT_S", "45")
    assert post_timeout("transcribe") == 45.0
    assert post_timeout("generate", "x" * 5000) == 45.0


def test_other_posts_keep_the_old_default(post_timeout):
    assert post_timeout() == 120.0


def test_unusable_values_fall_back(post_timeout, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", "soon")
    assert post_timeout("transcribe") == 300.0 + GRACE
    monkeypatch.setenv("OMNIVOICE_MCP_TIMEOUT_S", "-5")
    assert post_timeout("transcribe") == 120.0


# ── Parity with the backend's own clocks: a tool must never give up first ──


def test_transcribe_never_gives_up_before_the_backend(post_timeout):
    from services import asr_backend

    assert post_timeout("transcribe") > asr_backend.ASR_TRANSCRIBE_TIMEOUT_S


@pytest.mark.parametrize("device", ["cpu", "cuda", "mps"])
@pytest.mark.parametrize("text", ["short", "x" * 5000])
def test_generation_never_gives_up_before_the_backend(post_timeout, device, text):
    from services import model_manager as mm

    backend_worst = mm.GPU_QUEUE_TIMEOUT_S + mm.generate_timeout_s(text, execution_device=device)
    assert post_timeout("generate", text) > backend_worst
