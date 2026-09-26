"""The PyTorch wheel index Sesly installs CUDA builds from.

A local-version pin such as ``torch==2.9.1+cu128`` exists only on PyTorch's
own index, never on PyPI. The app's own ``pyproject.toml`` routes torch there
through ``[tool.uv.sources]``, but a sidecar engine is installed with
``uv pip install`` into its own venv, which knows nothing about that config —
so every CUDA-pinned sidecar install has to name the index itself.

MOSS-TTS-v1.5's install did not, and its ``[torch-runtime]`` extra
(``torch==2.9.1+cu128``) could never resolve: ``uv pip compile`` reports it
unsatisfiable without this index and resolves it with it. One definition here,
imported by the one-click installer and by the engine's own bootstrap, so the
two cannot drift apart again. ``tests/test_sidecar_install.py`` pins the URL
to the ``pytorch-cuda`` index declared in the app's ``pyproject.toml``.
"""

PYTORCH_CU128_INDEX_URL = "https://download.pytorch.org/whl/cu128"

# `unsafe-best-match`: the PyTorch index also mirrors common dependencies
# (numpy, pillow, sympy, …) at a narrower range of versions than PyPI. uv's
# default first-index strategy would stop at whichever index lists a name first
# and could pin an old mirror copy or fail outright. The index is PyTorch's
# official one, so the dependency-confusion risk the name warns about does not
# apply to it.
UV_PIP_CU128_ARGS: tuple[str, ...] = (
    "--extra-index-url",
    PYTORCH_CU128_INDEX_URL,
    "--index-strategy",
    "unsafe-best-match",
)

PYTORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"

# For an engine that runs torch only on the CPU (PocketTTS). On Linux, PyPI's
# torch is the CUDA build and pulls ~15 NVIDIA packages the engine never uses;
# this index serves `+cpu` builds for Linux and Windows and the regular build
# for macOS.
UV_PIP_CPU_ARGS: tuple[str, ...] = (
    "--extra-index-url",
    PYTORCH_CPU_INDEX_URL,
    "--index-strategy",
    "unsafe-best-match",
)
