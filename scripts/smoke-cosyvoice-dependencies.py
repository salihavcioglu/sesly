"""Check restored native/runtime dependencies in the isolated Python 3.10 env."""
import importlib.util
import gdown
import numpy as np
import pyarrow.parquet
import pyworld
import wget

assert importlib.util.find_spec('pkg_resources') is None
samples = np.sin(2 * np.pi * 220 * np.arange(24000) / 24000).astype(np.float64)
f0, times = pyworld.dio(samples, 24000)
f0 = pyworld.stonemask(samples, f0, times, 24000)
assert np.isfinite(f0).all() and np.any(f0 > 0)
print('CosyVoice dependency imports and native pitch extraction passed')
