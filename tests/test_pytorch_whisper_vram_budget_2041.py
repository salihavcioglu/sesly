"""#2041 — PyTorch Whisper demanded 5.0 GB of free VRAM for every model, sized
for full large-v3, so a 6 GB card was sent to CPU for the default
large-v3-turbo although CUDA ran the same audio in 37 s."""
import pytest

GiB = 1024**3


@pytest.fixture
def pick(monkeypatch):
    torch = pytest.importorskip("torch")
    from services import asr_backend as ab

    for name in ("OMNIVOICE_PYTORCH_ASR_MODEL", "OMNIVOICE_ASR_VRAM_PREFLIGHT"):
        monkeypatch.setenv(name, "x")  # recorded, so the teardown restores it
        monkeypatch.delenv(name)
    monkeypatch.setattr("services.model_manager.get_best_device", lambda: "cuda:0")
    warnings = []
    monkeypatch.setattr(ab.logger, "warning", lambda msg, *args: warnings.append(msg % args))

    def with_free(free_gb, model=None):
        monkeypatch.setattr(torch.cuda, "mem_get_info", lambda: (int(free_gb * GiB), 6 * GiB))
        return ab.PyTorchWhisperBackend._pick_device(model)

    with_free.warnings = warnings
    return with_free


def test_the_reported_6gb_card_keeps_turbo_on_cuda(pick):
    # The report: a 6 GB Quadro RTX 3000 with nothing else resident, 5.0 GB free.
    assert pick(5.0) == "cuda:0"


def test_turbo_still_falls_back_on_a_genuinely_full_card(pick):
    assert pick(2.0) == "cpu"


def test_full_large_v3_keeps_its_five_gigabyte_budget(pick):
    assert pick(4.5, "openai/whisper-large-v3") == "cpu"
    assert pick(5.2, "openai/whisper-large-v3") == "cuda:0"


def test_an_unknown_model_gets_the_conservative_budget(pick):
    assert pick(4.5, "someone/custom-asr") == "cpu"


def test_the_fallback_warning_names_the_model_and_the_opt_out(pick):
    pick(1.0)
    assert "OMNIVOICE_ASR_VRAM_PREFLIGHT=0" in pick.warnings[-1]
    assert "whisper-large-v3-turbo" in pick.warnings[-1]


@pytest.mark.parametrize(
    "custom",
    [
        "someone/turbo-whisper-xl",
        "acme/small-talk-asr",
        "org/database-asr",
        "openai/whisper-small-finetuned",
    ],
)
def test_a_custom_repo_with_a_size_word_keeps_the_conservative_budget(pick, custom):
    # Substring matching gave these a reduced budget and could admit a model
    # that then ran out of VRAM (#2044 review).
    assert pick(4.5, custom) == "cpu"


def test_english_only_checkpoints_and_stray_case_are_recognised(pick):
    assert pick(3.0, "openai/whisper-small.en") == "cuda:0"
    assert pick(3.0, " OpenAI/Whisper-Small ") == "cuda:0"
