"""Small, metadata-free local profile portraits."""
import io
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024


def normalize_portrait(data: bytes) -> bytes:
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Profile image exceeds 5 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("unsupported image format")
                if source.width * source.height > 16_000_000:
                    raise ValueError("image dimensions too large")
                portrait = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (256, 256))
                output = io.BytesIO()
                portrait.save(output, format="JPEG", quality=88)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Use a valid JPEG, PNG or WebP image up to 16 megapixels") from exc
