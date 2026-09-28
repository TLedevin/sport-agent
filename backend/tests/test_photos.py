import base64
import socket
from io import BytesIO

import httpx
import pytest
from PIL import Image

from app import photos


def png(width: int, height: int, transparent: bool = False) -> bytes:
    image = Image.new("RGBA" if transparent else "RGB", (width, height), (200, 30, 30, 0 if transparent else 255))
    out = BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def network(monkeypatch):
    """Fake DNS and HTTP: shop.example is public, intranet.example private; `pages` maps URL -> response."""
    pages: dict[str, httpx.Response] = {}
    addresses = {"shop.example": "93.184.216.34", "intranet.example": "10.0.0.5", "metadata.example": "169.254.169.254"}

    def getaddrinfo(host, *args, **kwargs):
        if host not in addresses:
            raise socket.gaierror("unknown")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addresses[host], 0))]

    monkeypatch.setattr(photos.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(photos, "_transport", httpx.MockTransport(lambda r: pages.get(str(r.url), httpx.Response(404))))
    return pages


def test_downloads_and_shrinks_to_webp(network):
    network["https://shop.example/shoe.png"] = httpx.Response(200, content=png(2000, 1000))
    image = Image.open(BytesIO(photos.shrink(photos.download("https://shop.example/shoe.png"))))
    assert image.format == "WEBP"
    assert image.size == (640, 320)  # longest side capped, proportions kept


def test_transparent_images_get_a_white_background():
    image = Image.open(BytesIO(photos.shrink(png(50, 50, transparent=True)))).convert("RGB")
    assert image.getpixel((25, 25)) == (255, 255, 255)


def test_data_urls_from_google_thumbnails():
    url = "data:image/png;base64," + base64.b64encode(png(80, 60)).decode()
    assert Image.open(BytesIO(photos.shrink(photos.download(url)))).size == (80, 60)
    with pytest.raises(photos.PhotoError, match="doesn't contain an image"):
        photos.download("data:text/html;base64,PGgxPg==")


def test_follows_redirects_but_never_into_a_private_network(network):
    network["https://shop.example/r"] = httpx.Response(302, headers={"location": "/shoe.png"})
    network["https://shop.example/shoe.png"] = httpx.Response(200, content=png(10, 10))
    assert photos.download("https://shop.example/r") == png(10, 10)

    network["https://shop.example/evil"] = httpx.Response(302, headers={"location": "http://metadata.example/token"})
    with pytest.raises(photos.PhotoError, match="public internet"):
        photos.download("https://shop.example/evil")
    for url in ("http://intranet.example/x.png", "http://127.0.0.1/x.png", "http://[::1]/x.png"):
        with pytest.raises(photos.PhotoError, match="public internet"):
            photos.download(url)


def test_explains_what_went_wrong(network):
    with pytest.raises(photos.PhotoError, match="https://"):
        photos.download("ftp://shop.example/shoe.png")
    with pytest.raises(photos.PhotoError, match="can't be found"):
        photos.download("https://nowhere.example/shoe.png")
    with pytest.raises(photos.PhotoError, match="HTTP 404"):
        photos.download("https://shop.example/missing.png")
    network["https://shop.example/page"] = httpx.Response(200, content=b"<html>a web page</html>")
    with pytest.raises(photos.PhotoError, match="isn't an image"):
        photos.shrink(photos.download("https://shop.example/page"))


def test_refuses_huge_files(network, monkeypatch):
    monkeypatch.setattr(photos, "MAX_DOWNLOAD", 1000)
    network["https://shop.example/big.png"] = httpx.Response(200, content=b"x" * 5000)
    with pytest.raises(photos.PhotoError, match="too large"):
        photos.download("https://shop.example/big.png")
