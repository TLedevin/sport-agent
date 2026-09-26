"""App password login and signed session tokens (sent as a Bearer header)."""

import hmac

from fastapi import Header, HTTPException
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import get_settings


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="session")


def check_password(password: str) -> bool:
    return hmac.compare_digest(password.encode(), get_settings().app_password.encode())


def create_session() -> str:
    return _serializer().dumps("me")


def require_session(authorization: str = Header(default="")) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        _serializer().loads(token, max_age=get_settings().session_max_age_days * 86400)
    except BadSignature:
        raise HTTPException(401, "Invalid or expired session")
