# 02 FRONTEND ARCHITECTURE

## Frameworks
- **Core:** Next.js (App Router).
- **Language:** TypeScript strictly enforced.
- **Styling:** Vanilla CSS / Tailwind (if requested) focusing on premium component architecture.

## State Management
- **Server State:** React Server Components + Next.js Server Actions.
- **Client State:** React Context/Zustand for complex UI states (e.g., Video calling).
- **Real-time State:** Supabase Realtime (WebSockets) for instant UI updates.

## Component Hierarchy
- Atomic design principles (Atoms -> Molecules -> Organisms).
- strict separation of Client Components (`"use client"`) and Server Components.

## Routing
- `src/app/(auth)`: Login/Signup.
- `src/app/dashboard`: Role-based protected routes (Admin, Nurse, Caregiver).
- `src/app/family`: Read-only portal for overseas sponsors.
- `src/app/resident`: Tablet interface.
