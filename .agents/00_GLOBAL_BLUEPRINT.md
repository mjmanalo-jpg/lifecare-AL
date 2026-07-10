# 00 GLOBAL BLUEPRINT

## Master Strategy
To build and maintain the "home-for-the-aged" application following the 7-Cycle Active Synthesis Protocol. The system is a B2B2C SaaS managing operations, clinical care, and a family portal, heavily integrated with Edge AI for elder safety.

## Target Architecture
- **Frontend:** Next.js (App Router) on Vercel
- **Backend:** Python FastAPI (Dockerized on GCP Cloud Run / AWS Fargate)
- **Database:** Supabase (PostgreSQL) + Prisma ORM
- **Monorepo:** plain **npm workspaces** (no Turborepo / `turbo.json` in this repo)

## Business Goals
Deliver engineering salvation by bridging world-class clinical operations (German standards) with deep AI integration (Voice Copilot, Camera Fall Detection) and total transparency for overseas families.
