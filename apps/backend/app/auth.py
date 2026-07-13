import httpx
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import SUPABASE_JWKS_URL, SUPABASE_ANON_KEY
from app.db import get_db

security = HTTPBearer(auto_error=False)

_jwks_cache: dict = {}


async def _get_jwks() -> dict:
    if _jwks_cache.get("keys"):
        return _jwks_cache
    async with httpx.AsyncClient() as client:
        resp = await client.get(SUPABASE_JWKS_URL, timeout=10)
        resp.raise_for_status()
        _jwks_cache["keys"] = resp.json().get("keys", [])
    return _jwks_cache


def _get_signing_key(jwks: dict, token: str):
    from jose.utils import long_to_bytes
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            from jose.jwt import RSAKey
            return RSAKey(key)
    raise HTTPException(status_code=401, detail="Unable to find matching signing key")


async def decode_token(token: str) -> dict:
    try:
        jwks = await _get_jwks()
        signing_key = _get_signing_key(jwks, token)
        payload = jwt.decode(token, signing_key, algorithms=["RS256"], audience="authenticated")
        return payload
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = await decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    from app.models.portal import User
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "name": user.name,
    }


def require_roles(*allowed_roles):
    async def role_checker(user: dict = Depends(get_current_user)):
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return role_checker
