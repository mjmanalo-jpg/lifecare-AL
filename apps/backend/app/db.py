"""
PostgreSQL + Supabase Database Configuration
Async connection pool using asyncpg for FastAPI
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import pool
from app.config import DATABASE_URL

# Create async engine with connection pooling
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    poolclass=pool.NullPool,  # Disable pooling for serverless environments (Cloud Run, Fargate)
    pool_pre_ping=True,  # Verify connections before use
    connect_args={"statement_cache_size": 0},
)

# Create async session factory
AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

async def get_db():
    """Dependency for getting database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def close_db():
    """Close all database connections"""
    await engine.dispose()
