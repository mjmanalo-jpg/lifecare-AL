# 05 DEVOPS VERCEL

## Deployment Pipeline
- **Monorepo Manager:** Turborepo handles shared build caches.
- **Frontend (Next.js):** Continuous Deployment to Vercel via GitHub integration.
- **Backend (FastAPI):** Dockerized and deployed to Google Cloud Run / AWS Fargate.

## CI/CD
- GitHub Actions for testing Python backend (`pytest`) and Next.js frontend (`jest`/`vitest`).
- Pre-commit hooks for Linting (`eslint` & `flake8` / `black`).

## Environment Variables
- Validated via Pydantic Settings (Python) and T3 Env (Next.js).
- Stored securely in Vercel / Cloud Run Secrets Manager.

## Hosting
- Target: Vercel (Frontend) + Containerized Host (Backend) + Supabase (DB/Auth/Realtime).
