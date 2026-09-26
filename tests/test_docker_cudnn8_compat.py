"""Exercise the Docker compatibility install without downloading NVIDIA wheels."""
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('flavor,empty,success', [('cuda', False, True), ('rocm', False, True), ('cuda', True, False)])
def test_compat_install_is_isolated_and_cuda_only(tmp_path, flavor, empty, success):
    dockerfile = (ROOT / 'deploy/Dockerfile').read_text()
    match = re.search(r'RUN if \[ "\$GPU_FLAVOR" = "cuda" \]; then \\\n.*?    fi', dockerfile, re.S)
    assert match, 'CUDA compatibility install is absent'
    script = match[0].removeprefix('RUN ').replace('\\\n', '')
    bindir = tmp_path / 'bin'
    bindir.mkdir()
    prefix = tmp_path / 'runtime'
    (bindir / 'python3').write_text(f'#!{sys.executable}\nimport sys\nsys.prefix={str(prefix)!r}\nexec(sys.argv[2])\n')
    (bindir / 'uv').write_text(f'''#!{sys.executable}
import sys
from pathlib import Path
args=sys.argv[1:]
assert '--no-deps' in args and 'nvidia-cudnn-cu12==8.9.7.29' in args
assert '--target' in args
root=Path(args[args.index('--target')+1])
assert root.name == 'cudnn8_compat'
(root/'nvidia/cudnn/lib').mkdir(parents=True)
if not {empty!r}: (root/'nvidia/cudnn/lib/libcudnn_ops_infer.so.8').touch()
''')
    for p in bindir.iterdir(): p.chmod(0o755)
    env = dict(os.environ, PATH=str(bindir)+os.pathsep+os.environ['PATH'], GPU_FLAVOR=flavor)
    result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
    assert (result.returncode == 0) == success, result.stderr
    if flavor == 'cuda':
        expected = prefix / f'lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages/cudnn8_compat/nvidia/cudnn/lib'
        assert expected.is_dir()
    else:
        assert not prefix.exists(), 'ROCm must not install NVIDIA libraries'
