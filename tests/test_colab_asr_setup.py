"""Execute notebook prerequisite ordering with mocked downloads (#1922)."""
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


NOTEBOOK = Path(__file__).resolve().parents[1] / "notebooks/Sesly_Colab.ipynb"


class ColabASRSetupTests(unittest.TestCase):
    def setup_source(self):
        cells = json.loads(NOTEBOOK.read_text())["cells"]
        for cell in cells:
            source = "".join(cell["source"])
            if cell["cell_type"] == "code" and "12a. Install the transcription model" in source:
                return source
        self.fail("Notebook needs an explicit ASR setup cell before transcription")

    def test_setup_downloads_exact_repo_and_can_be_rerun(self):
        calls = []
        def download(repo_id):
            self.assertEqual(repo_id, "Systran/faster-whisper-large-v3")
            calls.append(repo_id)
            return "/fake/hub/snapshot"

        module = types.ModuleType("huggingface_hub")
        module.snapshot_download = download
        scope = {}
        with patch.dict(sys.modules, {"huggingface_hub": module}):
            exec(self.setup_source(), scope)
            self.assertTrue(scope["ASR_MODEL_READY"])
            self.assertEqual(len(calls), 1)
            calls.clear()
            exec(self.setup_source(), scope)
            self.assertEqual(len(calls), 1)

    def test_failed_download_clears_previous_ready_state(self):
        module = types.ModuleType("huggingface_hub")

        def download(*args, **kwargs):
            raise OSError("download interrupted")

        module.snapshot_download = download
        scope = {"ASR_MODEL_READY": True}
        with patch.dict(sys.modules, {"huggingface_hub": module}):
            with self.assertRaises(OSError):
                exec(self.setup_source(), scope)
        self.assertFalse(scope["ASR_MODEL_READY"])

    def test_transcription_and_dubbing_gate_before_any_work(self):
        cells = json.loads(NOTEBOOK.read_text())["cells"]
        for number in (13, 18):
            source = next("".join(c["source"]) for c in cells
                          if c["cell_type"] == "code"
                          and f" {number}. " in "".join(c["source"]).splitlines()[0])
            with self.subTest(cell=number):
                with self.assertRaisesRegex(SystemExit, "12a"):
                    exec(source, {})

    def test_setup_precedes_transcription_in_run_all(self):
        code = ["".join(c["source"]) for c in json.loads(NOTEBOOK.read_text())["cells"]
                if c["cell_type"] == "code"]
        setup = next(i for i, s in enumerate(code)
                     if "12a. Install the transcription model" in s)
        transcribe = next(i for i, s in enumerate(code)
                          if " 13. " in s.splitlines()[0])
        self.assertLess(setup, transcribe)


if __name__ == "__main__":
    unittest.main()
