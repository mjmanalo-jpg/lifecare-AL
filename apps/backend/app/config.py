import os
from pathlib import Path
from functools import lru_cache
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

_backend_env = Path(__file__).resolve().parent.parent / ".env"
_frontend_env = Path(__file__).resolve().parent.parent.parent / "frontend" / ".env.local"
load_dotenv(dotenv_path=_backend_env, override=True)
load_dotenv(dotenv_path=_frontend_env, override=True)


def _async_database_url() -> str:
    url = os.getenv("APP_DATABASE_URL") or os.getenv("ASYNC_DATABASE_URL") or os.getenv("DATABASE_URL", "")
    if not url:
        return ""
    
    # Standardize scheme for parsing if needed
    has_postgres = False
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        has_postgres = True
        
    parsed = urlparse(url)
    
    # Extract credentials and percent-encode the username and password
    from urllib.parse import quote_plus, unquote
    username = unquote(parsed.username) if parsed.username is not None else None
    password = unquote(parsed.password) if parsed.password is not None else None
    
    # Reconstruct the netloc (credentials + host + port)
    netloc = ""
    if username is not None:
        netloc += quote_plus(username)
        if password is not None:
            netloc += ":" + quote_plus(password)
        netloc += "@"
    netloc += parsed.hostname or ""
    if parsed.port is not None:
        netloc += f":{parsed.port}"
        
    query_params = parse_qs(parsed.query)
    # Remove parameters that asyncpg doesn't support
    if "pgbouncer" in query_params:
        del query_params["pgbouncer"]
        
    new_query = urlencode(query_params, doseq=True)
    parsed = parsed._replace(netloc=netloc, query=new_query)
    
    # Reconstruct with asyncpg scheme if it was a postgres url
    final_url = urlunparse(parsed)
    if has_postgres:
        if final_url.startswith("postgresql://"):
            final_url = final_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif final_url.startswith("postgres://"):
            final_url = final_url.replace("postgres://", "postgresql+asyncpg://", 1)
            
    return final_url


DATABASE_URL = _async_database_url()
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("ANON_KEY_PUBLIC", "")
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL") or (f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else "")
