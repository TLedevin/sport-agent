"""Gear photos: the address of an image found online (e.g. on Google Images) is downloaded once,
shrunk and stored in the database, so the photo keeps showing even if the site removes it."""

import base64
import binascii
import ipaddress
import socket
from datetime import UTC, datetime
from io import BytesIO
from urllib.parse import unquote_to_bytes, urljoin, urlparse

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from .models import GearPhoto

MAX_DOWNLOAD = 10 * 1024 * 1024  # bytes
MAX_SIDE = 640  # px: sharp on a card, even on a high-density screen
QUALITY = 80
MAX_PIXELS = 40_000_000  # refuse "decompression bombs" before decoding them
TIMEOUT = 10  # seconds
MAX_REDIRECTS = 3
# Some sites refuse requests that don't look like a browser.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
}


_transport: httpx.BaseTransport | None = None  # tests plug a fake network in here


class PhotoError(ValueError):
    """A problem to show as is: the address, the download or the file."""


def _check_host(host: str) -> None:
    """The server only fetches public addresses: never its own network (e.g. Azure's internal
    metadata service at 169.254.169.254), whatever the pasted link points to."""
    try:
        addresses = {str(ipaddress.ip_address(host))}  # an address typed as is
    except ValueError:
        try:
            addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
        except socket.gaierror:
            raise PhotoError("This site can't be found. Check the address.")
    if not addresses or any(not ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses):
        raise PhotoError("This address isn't on the public internet.")


def _from_data_url(url: str) -> bytes:
    """"Copy image address" on a Google Images thumbnail gives the image itself: data:image/...;base64,..."""
    header, _, payload = url[5:].partition(",")
    if not header.startswith("image/"):
        raise PhotoError("This link doesn't contain an image.")
    try:
        data = base64.b64decode(payload, validate=False) if header.endswith(";base64") else unquote_to_bytes(payload)
    except binascii.Error:
        raise PhotoError("This image link is damaged. Copy it again.")
    if len(data) > MAX_DOWNLOAD:
        raise PhotoError("This image is too large.")
    return data


def download(url: str) -> bytes:
    url = url.strip()
    if url.startswith("data:"):
        return _from_data_url(url)
    with httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=False, transport=_transport) as client:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise PhotoError("Paste an image address starting with https://")
            _check_host(parsed.hostname)  # checked again on every redirect
            try:
                with client.stream("GET", url) as response:
                    if response.is_redirect and "location" in response.headers:
                        url = urljoin(url, response.headers["location"])
                        continue
                    if response.status_code != 200:
                        raise PhotoError(f"The site refused to send the image (HTTP {response.status_code}).")
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        data += chunk
                        if len(data) > MAX_DOWNLOAD:
                            raise PhotoError("This image is too large.")
                    return bytes(data)
            except httpx.HTTPError:
                raise PhotoError("The site didn't answer. Try another image.")
    raise PhotoError("This address redirects too many times.")


def shrink(data: bytes) -> bytes:
    """Any common image format -> WebP, at most MAX_SIDE px, upright, on white if transparent."""
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise PhotoError("This isn't an image (the address may lead to a web page: copy the image address).")
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = BytesIO()
    image.save(out, "WEBP", quality=QUALITY, method=6)
    return out.getvalue()


def save(db: Session, gear_uuid: str, url: str) -> GearPhoto:
    image = shrink(download(url))
    photo = db.get(GearPhoto, gear_uuid) or GearPhoto(gear_uuid=gear_uuid)
    photo.image = image
    photo.content_type = "image/webp"
    photo.source_url = None if url.strip().startswith("data:") else url.strip()[:2000]
    photo.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(photo)
    db.commit()
    return photo
