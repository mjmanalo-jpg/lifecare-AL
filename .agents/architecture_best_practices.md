# 🏆 Architecture Best Practices & Clean Code Standards

> **STATUS: APPROVED & ACTIVE**
> **PROTOCOL: 7-CYCLE ACTIVE SYNTHESIS**

This document establishes the sovereign coding standards, architectural best practices, and the deployment strategy for the Next.js and FastAPI stack. This ensures the codebase remains robust, scalable, and capable of handling complex AI and WebRTC workloads.

---

## 1. STRATEGIC DEPLOYMENT: "Split-Hosting"

To accommodate both Serverless UI rendering and Long-Running AI/WebSocket connections, we utilize a Split-Hosting methodology.

- **Frontend (Next.js):** Hosted on **Vercel**.
  - *Why:* Unmatched edge network caching, zero-config CI/CD, optimized React Server Components.
- **Backend (FastAPI):** Dockerized and hosted on **Google Cloud Run** or **AWS Fargate** (or Render).
  - *Why:* Vercel Serverless Functions will timeout and drop connections. FastAPI on a persistent container allows continuous WebSocket streams for the Real-Time Camera Fall Detection and Voice AI Copilot.
- **Monorepo Manager:** **Turborepo**.
  - *Why:* Orchestrates a single codebase where `npm run dev` builds and serves both Next.js and FastAPI concurrently during local development.

---

## 2. CLEAN CODE STANDARDS (The Sovereign Way)

### A. Next.js Frontend (React/TypeScript)
1. **Strict Typing:** `any` is strictly prohibited. All props, API responses, and state must have defined TypeScript interfaces.
2. **Server Components by Default:** Assume all components are React Server Components unless they require interactivity (`useState`, `onClick`). Use the `"use client"` directive sparingly and push it down the component tree as far as possible.
3. **Atomic Design:** UI components live in `src/components/` and are grouped into Atoms (Buttons), Molecules (Forms), and Organisms (Dashboards).
4. **Server Actions for Mutations:** Instead of writing custom `/api` routes for simple database writes, use Next.js Server Actions placed in `src/actions/`.

### B. FastAPI Backend (Python)
1. **Pydantic Validation:** All incoming and outgoing data must be validated using Pydantic models.
2. **Dependency Injection:** Use FastAPI's `Depends()` for database sessions, authentication checks, and external API clients. This makes unit testing significantly easier.
3. **Asynchronous I/O:** Always use `async def` and `await` for database calls, file I/O, or external AI model requests to prevent thread blocking.
4. **Router Modularity:** Do not bloat `main.py`. Split routes into functional domains (e.g., `api/v1/voice.py`, `api/v1/camera.py`).

### C. Database & Prisma (Supabase)
1. **Source of Truth:** The `schema.prisma` file is the absolute source of truth for the data model.
2. **Migrations:** Never alter tables directly in the Supabase UI. Always use `npx prisma migrate dev` to maintain a strict version history.
3. **Realtime Pub/Sub:** Offload complex UI syncing to Supabase Realtime. When FastAPI writes a Fall Detection alert to the database, Supabase instantly pushes it to Next.js clients via WebSockets.

---

## 3. SECURITY & PRIVACY
- **HIPAA Compliance:** Raw camera footage is processed on the Edge (or rapidly discarded in RAM) and is **never** saved to blob storage unless an incident is triggered.
- **Environment Parity:** `.env` variables are strictly validated on startup using Pydantic Settings in Python and T3 Env in Next.js to prevent deployment failures.
- **Role-Based Access Control (RBAC):** Supabase Row Level Security (RLS) policies enforce that family members can only read data associated with their sponsored resident.
