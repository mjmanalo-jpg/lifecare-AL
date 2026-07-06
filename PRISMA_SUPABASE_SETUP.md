# Prisma + Supabase Setup Guide
> **DATABASE: PostgreSQL (Supabase Only) — NO MS SQL**

## Overview
- **ORM:** Prisma Client
- **Database:** Supabase (PostgreSQL)
- **Frontend:** Next.js with Prisma integration
- **Backend:** FastAPI with async PostgreSQL driver

---

## 1. Environment Configuration

### Frontend (.env.local)
```env
# Supabase PostgreSQL Connection
DATABASE_URL="postgresql://[user]:[password]@[host]:[port]/[database]?schema=public"
DIRECT_URL="postgresql://[user]:[password]@[host]:[port]/[database]?schema=public"
```

### Backend (backend/.env)
```env
# Supabase PostgreSQL
DATABASE_URL="postgresql://[user]:[password]@[host]:[port]/[database]?schema=public"
ASYNC_DATABASE_URL="postgresql+asyncpg://[user]:[password]@[host]:[port]/[database]"
```

---

## 2. Prisma Schema (apps/frontend/prisma/schema.prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

**Key Points:**
- `provider = "postgresql"` — Strictly PostgreSQL
- NO SQL Server, NO MySQL, NO SQLite in production
- `directUrl` for connection pooling (required for Supabase)

---

## 3. Core Data Models

### Users & Authentication
```prisma
model User {
  id        String   @id @default(uuid())
  role      Role     @default(FAMILY)
  email     String   @unique
  name      String
  residents Resident[]
  createdAt DateTime @default(now())
}

enum Role { SUPERADMIN, NURSE, CAREGIVER, FAMILY }
```

### Resident Management
```prisma
model Resident {
  id           String      @id @default(uuid())
  name         String
  careLevel    CareLevel
  roomNumber   String      @unique
  sponsorId    String
  sponsor      User        @relation(fields: [sponsorId], references: [id])
  vitals       VitalsLog[]
  incidents    Incident[]
  createdAt    DateTime    @default(now())
}

enum CareLevel { INDEPENDENT, ASSISTED, MEMORY, SKILLED }
```

### Clinical Data (Time-Series)
```prisma
model VitalsLog {
  id         String   @id @default(uuid())
  residentId String
  resident   Resident @relation(fields: [residentId], references: [id])
  type       VitalType
  value      String
  recordedAt DateTime @default(now())
  loggedById String
  
  @@index([residentId])
  @@index([recordedAt])
}

enum VitalType { BLOOD_PRESSURE, HEART_RATE, TEMPERATURE, OXYGEN }
```

### Incident Tracking
```prisma
model Incident {
  id           String   @id @default(uuid())
  residentId   String
  resident     Resident @relation(fields: [residentId], references: [id])
  type         String
  description  String
  severity     String
  triggeredAt  DateTime @default(now())
  resolvedAt   DateTime?
  
  @@index([residentId])
  @@index([triggeredAt])
}
```

---

## 4. Migration Workflow

### First Time Setup
```bash
cd apps/frontend

# Install Prisma CLI
npm install -D prisma

# Generate initial migration
npx prisma migrate dev --name init

# Generate Prisma Client
npx prisma generate
```

### Subsequent Schema Changes
```bash
# Create new migration
npx prisma migrate dev --name add_feature_name

# Deploy to production
npx prisma migrate deploy
```

### Reset Database (Development Only)
```bash
npx prisma migrate reset
```

---

## 5. Backend Integration (FastAPI)

### Install Dependencies
```bash
cd apps/backend
pip install databases asyncpg sqlalchemy
```

### Database Connection (async)
```python
# app/db.py
import databases

DATABASE_URL = "postgresql+asyncpg://user:password@host:port/database"
database = databases.Database(DATABASE_URL)

async def get_db():
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()
```

### Using Prisma Client from Next.js
```typescript
// apps/frontend/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

## 6. Indexing Strategy

### High-Frequency Lookups
```prisma
@@index([residentId])      // Resident queries
@@index([recordedAt])      // Time-series queries
@@index([type])            // Vital type filters
```

### Composite Indexes (Performance)
```prisma
@@unique([residentId, recordedAt])  // Prevent duplicate vitals
```

---

## 7. Supabase-Specific Features

### Row Level Security (RLS)
Enable RLS on tables to enforce role-based access:
```sql
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Resident" ENABLE ROW LEVEL SECURITY;
```

### Connection Pooling
- **PgBouncer:** Enabled by default on Supabase
- **directUrl:** Points to non-pooled connection for migrations
- **DATABASE_URL:** Points to pooled connection for queries

### Realtime Subscriptions (Optional)
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, key)

supabase
  .channel('vitals')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'VitalsLog' }, (payload) => {
    console.log('New vital:', payload)
  })
  .subscribe()
```

---

## 8. Security Checklist

- ✅ PostgreSQL only (Supabase)
- ✅ NO MS SQL, NO MySQL, NO SQLite in production
- ✅ Environment variables for connection strings
- ✅ Prisma schema versioned in git
- ✅ Migrations tracked (prisma/migrations/)
- ✅ RLS policies enforced on sensitive tables
- ✅ Role-based access control at DB layer

---

## 9. Deployment

### Vercel (Frontend)
```bash
# Environment variables
DATABASE_URL = "postgresql://..."
DIRECT_URL = "postgresql://..."
```

### Cloud Run / Fargate (Backend)
```bash
# Environment variables
DATABASE_URL = "postgresql+asyncpg://..."
```

### Supabase Console
- Monitor connections
- View query performance
- Manage RLS policies
- Backup schedules

---

## 10. Troubleshooting

| Issue | Solution |
|-------|----------|
| `Connection pool exhausted` | Use `directUrl` for migrations, `DATABASE_URL` for queries |
| `Prisma migrate fails` | Check `DIRECT_URL` in .env, ensure it's non-pooled |
| `Type mismatch` | Run `npx prisma generate` after schema changes |
| `Production deployment hangs` | Verify Supabase connection limits in dashboard |

---

**GLORY TO THE ALMIGHTY LORD JESUS CHRIST.**

This setup is PostgreSQL + Prisma only. No other databases will be supported.
