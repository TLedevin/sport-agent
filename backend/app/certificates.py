"""Race certificates: the organiser's PDF (or a photo or scan of it), kept as is so it stays
readable. A race result can have several."""

import base64
import binascii
import hashlib
import hmac
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from urllib.parse import quote, unquote_to_bytes

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from . import photos
from .config import get_settings
from .models import RaceCertificate

MAX_SIZE = photos.MAX_DOWNLOAD  # 10 MB
IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif"}
EXTENSIONS = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


class CertificateError(ValueError):
    """A problem to show as is."""


def _read(url: str) -> bytes:
    """A file picked on the device arrives as a data: URL (any type); a link is downloaded the
    same way as photos (public addresses only, size capped)."""
    url = url.strip()
    if url.startswith("data:"):
        header, _, payload = url[5:].partition(",")
        try:
            data = base64.b64decode(payload) if header.endswith(";base64") else unquote_to_bytes(payload)
        except binascii.Error:
            raise CertificateError("This file couldn't be read. Try again.")
    else:
        try:
            data = photos.download(url)
        except photos.PhotoError as err:
            raise CertificateError(str(err))
    if not data:
        raise CertificateError("This file is empty.")
    if len(data) > MAX_SIZE:
        raise CertificateError("This file is too large (10 MB at most).")
    return data


def identify(data: bytes) -> str:
    """The content type, from the file's content rather than its name."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    try:
        with Image.open(BytesIO(data)) as image:
            kind = IMAGE_TYPES.get(image.format or "")
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        kind = None
    if not kind:
        raise CertificateError("A certificate must be a PDF or an image (JPG, PNG, WebP).")
    return kind


def _filename(name: str | None, content_type: str) -> str:
    stem = PurePath((name or "").replace("\\", "/")).stem.strip()[:200] or "certificate"
    return stem + EXTENSIONS[content_type]


MAX_PER_RACE = 20


def add(db: Session, activity_id: int, url: str, filename: str | None) -> RaceCertificate:
    data = _read(url)
    content_type = identify(data)
    certificate = RaceCertificate(
        activity_id=activity_id, data=data, content_type=content_type, size=len(data),
        filename=_filename(filename, content_type), uploaded_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db.add(certificate)
    db.commit()
    return certificate


# A link opened in a new tab can't send the session header: like photos, the address carries a
# signature tied to the certificate. A certificate's file never changes (a new one gets a new id).

def _signature(certificate_id: int) -> str:
    key = get_settings().session_secret.encode()
    return hmac.new(key, f"race-certificate-file:{certificate_id}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_url(certificate_id: int) -> str:
    return f"/api/certificates/{certificate_id}?sig={_signature(certificate_id)}"


def valid_signature(certificate_id: int, sig: str) -> bool:
    return hmac.compare_digest(_signature(certificate_id), sig)


def disposition(filename: str) -> str:
    """Shown in the browser (inline), saved under its name when downloaded."""
    ascii_name = filename.encode("ascii", "replace").decode().replace('"', "")
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
