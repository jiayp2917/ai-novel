import ipaddress
import secrets

from fastapi import Header, HTTPException, Request

from backend.app.core.config import get_settings


def require_admin_access(
    request: Request,
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> None:
    expected = (get_settings().admin_api_token or "").strip()
    if expected:
        supplied = _bearer_token(authorization) or (x_admin_token or "").strip()
        if secrets.compare_digest(supplied, expected):
            return
        raise HTTPException(status_code=401, detail="Admin API token required")
    if _is_loopback_request(request):
        return
    raise HTTPException(status_code=403, detail="Admin API is local-only unless ADMIN_API_TOKEN is set")


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _is_loopback_request(request: Request) -> bool:
    if request.client is None:
        return False
    if request.client.host in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(request.client.host).is_loopback
    except ValueError:
        return False
