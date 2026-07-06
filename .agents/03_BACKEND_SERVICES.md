# 03 BACKEND SERVICES

## API Design
- **RESTful API** powered by FastAPI (Python) for AI, telemetry, and heavy operations.
- **Next.js API Routes** for lightweight Backend-For-Frontend (BFF) mutations.

## Server Architecture
- **FastAPI Core:** Domain-driven modular routers (`/api/v1/voice`, `/api/v1/camera`).
- **Asynchronous I/O:** `async def` enforced for non-blocking performance.
- **AI Orchestrator:** Edge AI handling for Optical Matrix and LLM integrations for Voice Copilot.

## Middleware
- CORS configuration for Next.js cross-origin requests.
- Pydantic validation middleware.
- JWT decoding middleware matching Supabase Auth.

## Security
- Strict Role-Based Access Control (RBAC).
- Edge processing of camera feeds to prevent unauthorized raw footage storage.
