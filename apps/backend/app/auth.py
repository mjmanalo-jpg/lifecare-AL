import httpx
from jose import jwt, JWTError
from fastapi import Depends, HTTPException
from starlette.requests import HTTPConnection
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.config import SUPABASE_JWKS_URL
from app.db import get_db
from app.models.portal import User

_jwks_cache: dict = {}

async def _get_jwks() -> dict:
    if _jwks_cache.get("keys"):
        return _jwks_cache
    async with httpx.AsyncClient() as client:
        response = await client.get(SUPABASE_JWKS_URL, timeout=10)
        response.raise_for_status()
        _jwks_cache["keys"] = response.json().get("keys", [])
    return _jwks_cache

async def decode_token(token: str) -> dict:
    try:
        jwks = await _get_jwks()
        header = jwt.get_unverified_header(token)
        key = next((item for item in jwks.get("keys", []) if item.get("kid") == header.get("kid")), None)
        if not key:
            raise HTTPException(status_code=401, detail="Invalid token")
        return jwt.decode(token, key, algorithms=[header.get("alg", "RS256")], audience="authenticated")
    except (JWTError, StopIteration):
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(
    connection: HTTPConnection,
    db: AsyncSession = Depends(get_db),
) -> dict:
    authorization = connection.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ").strip() or connection.query_params.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = await decode_token(token)
    auth_user_id = payload.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.authUserId == auth_user_id, User.isActive.is_(True)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Account not provisioned")

    organization_id = connection.headers.get("x-organization-id") or connection.query_params.get("organization_id")
    community_id = connection.headers.get("x-community-id") or connection.query_params.get("community_id")
    is_platform = bool(user.platformRole)
    organization_role = None
    effective_role = user.role

    if not is_platform:
        if not organization_id or not community_id:
            raise HTTPException(status_code=400, detail="Workspace headers are required")
        org_row = (await db.execute(text('''
            SELECT om."role", o."status", s."status" AS subscription_status
            FROM "OrganizationMembership" om
            JOIN "Organization" o ON o."id" = om."organizationId"
            LEFT JOIN "Subscription" s ON s."organizationId" = o."id"
            WHERE om."userId" = :user_id AND om."organizationId" = :organization_id
              AND om."status" = 'ACTIVE'
        '''), {"user_id": user.id, "organization_id": organization_id})).mappings().first()
        if not org_row or org_row["status"] != "ACTIVE" or org_row["subscription_status"] not in (None, "TRIALING", "ACTIVE"):
            raise HTTPException(status_code=403, detail="Workspace unavailable")
        organization_role = org_row["role"]
        community_row = (await db.execute(text('''
            SELECT c."id", cm."role"
            FROM "Community" c
            LEFT JOIN "CommunityMembership" cm
              ON cm."communityId" = c."id" AND cm."userId" = :user_id AND cm."status" = 'ACTIVE'
            WHERE c."id" = :community_id AND c."organizationId" = :organization_id AND c."isActive" = true
        '''), {"user_id": user.id, "community_id": community_id, "organization_id": organization_id})).mappings().first()
        if not community_row or (not community_row["role"] and organization_role not in ("OWNER", "ADMIN")):
            raise HTTPException(status_code=404, detail="Workspace not found")
        effective_role = community_row["role"] or "FACILITY_ADMIN"

    db.info["organization_id"] = organization_id
    db.info["community_id"] = community_id
    db.info["user_id"] = user.id
    await db.execute(text("SELECT set_config('app.user_id', :value, true)"), {"value": user.id})
    await db.execute(text("SELECT set_config('app.organization_id', :value, true)"), {"value": organization_id or ""})
    await db.execute(text("SELECT set_config('app.community_id', :value, true)"), {"value": community_id or ""})
    await db.execute(text("SELECT set_config('app.is_platform', :value, true)"), {"value": "true" if is_platform else "false"})
    return {"id": user.id, "email": user.email, "role": effective_role, "name": user.name, "platformRole": user.platformRole, "organizationRole": organization_role, "organizationId": organization_id, "communityId": community_id}

def require_roles(*allowed_roles):
    async def role_checker(user: dict = Depends(get_current_user)):
        if user["role"] not in allowed_roles and not user.get("platformRole"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return role_checker