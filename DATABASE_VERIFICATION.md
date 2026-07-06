# Database Architecture Verification
## PostgreSQL + Prisma + Supabase Only (ZERO MS SQL)

**Status:** ✅ VERIFIED - No MS SQL, SQL Server, or MSSQL references anywhere in the project

---

## Audit Results

### ✅ Frontend Dependencies
```json
{
  "@prisma/client": "^5.9.0",
  "@supabase/supabase-js": "^2.38.0",
  "prisma": "^5.9.0"
}
```
- NO SQL Server client
- NO pyodbc, pymssql, or ODBC drivers
- NO mssql package
- **ONLY PostgreSQL + Supabase**

### ✅ Backend Dependencies
```
asyncpg>=0.29.0        # PostgreSQL async driver
sqlalchemy>=2.0.0      # ORM for PostgreSQL
databases>=0.8.0       # Async query builder
```
- NO pyodbc, pymssql
- NO sqlalchemy[mssql]
- NO MS SQL Server drivers
- **ONLY PostgreSQL async support**

### ✅ Prisma Configuration
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```
- Provider: `postgresql` (NOT mysql, sqlite, sqlserver, mongodb)
- Connection pooling via Supabase PgBouncer
- Direct URL for Prisma migrations

### ✅ Schema Models
```
User
├── Resident (1:N)
├── VitalsLog (time-series, indexed by recordedAt)
└── Incident (indexed by triggeredAt)
```
- All relationships use PostgreSQL foreign keys
- Composite indexes for query optimization
- Cascading deletes for referential integrity
- `@updatedAt` timestamps for audit trail

---

## Database Stack

### Frontend (Next.js)
- **ORM:** Prisma Client (PostgreSQL)
- **Client:** @supabase/supabase-js
- **Connection:** Pooled via DATABASE_URL
- **Migrations:** `npx prisma migrate dev`

### Backend (FastAPI)
- **Async Driver:** asyncpg (PostgreSQL)
- **Query Layer:** SQLAlchemy 2.0 (async)
- **Connection Pool:** NullPool for serverless
- **Database:** databases library (async wrapper)

### Database (Supabase)
- **Engine:** PostgreSQL 16+
- **Connection Pooling:** PgBouncer (Supabase)
- **Backups:** Daily snapshots
- **SSL:** TLS 1.2+ required
- **RLS:** Row-Level Security enabled

---

## Environment Configuration

### .env Variables (PostgreSQL only)
```env
# Pooled connection (queries)
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"

# Direct connection (migrations)
DIRECT_URL="postgresql://user:pass@host:5432/db?schema=public"

# Async backend connection
ASYNC_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db"
```

**Zero MS SQL environment variables are needed or supported.**

---

## Security Commitments

| Component | Status | Details |
|-----------|--------|---------|
| **MS SQL Support** | ❌ REMOVED | No drivers, no dependencies |
| **PostgreSQL Support** | ✅ ACTIVE | asyncpg, SQLAlchemy, Prisma |
| **Supabase Auth** | ✅ INTEGRATED | JWT via DIRECT_URL |
| **RLS Policies** | ✅ ENFORCED | Role-based database access |
| **SSL/TLS** | ✅ REQUIRED | All connections encrypted |
| **Audit Trail** | ✅ ENABLED | createdAt, updatedAt on all tables |

---

## Deployment Verification

### Vercel (Frontend)
- ✅ DATABASE_URL → Supabase PostgreSQL
- ✅ DIRECT_URL → Supabase PostgreSQL  
- ✅ Prisma Client generated for PostgreSQL
- ❌ No SQL Server ODBC drivers needed

### Cloud Run / Fargate (Backend)
- ✅ ASYNC_DATABASE_URL → PostgreSQL+asyncpg
- ✅ asyncpg driver available in requirements.txt
- ✅ Connection pooling for serverless
- ❌ No pyodbc, pymssql, or T-SQL needed

### Supabase Console
- ✅ PostgreSQL tables created
- ✅ RLS policies enforced
- ✅ Connection pooling active
- ✅ Backup schedule configured

---

## Migration Workflow

### Initial Setup
```bash
cd apps/frontend
npm install
npx prisma generate
npx prisma migrate dev --name init
```

### Schema Changes
```bash
# Update schema.prisma
npx prisma migrate dev --name add_feature

# Deploy to production
npx prisma migrate deploy
```

### Rollback (if needed)
```bash
npx prisma migrate resolve --rolled-back migration_name
```

---

## Performance Optimization

### Indexes (PostgreSQL)
```sql
-- Automatic indexes created by Prisma
CREATE INDEX idx_resident_sponsor ON "Resident"("sponsorId");
CREATE INDEX idx_vitals_timestamp ON "VitalsLog"("recordedAt");
CREATE INDEX idx_incident_severity ON "Incident"("severity");
```

### Query Optimization
- ✅ Composite indexes for multi-column queries
- ✅ Time-series optimization for vital logs
- ✅ Unique constraints prevent duplicates
- ✅ Connection pooling reduces latency

### Async Performance
- ✅ asyncpg in backend (non-blocking I/O)
- ✅ Prisma Client in frontend (connection reuse)
- ✅ Supabase PgBouncer (reduced connection overhead)
- ✅ Serverless-optimized (NullPool for cold starts)

---

## ZERO MS SQL Guarantee

| Forbidden | Status | Reason |
|-----------|--------|--------|
| SQL Server | ❌ NOT USED | No sqlserver datasource provider |
| MSSQL | ❌ NOT USED | No mssql npm package |
| pyodbc | ❌ NOT USED | No ODBC driver in requirements.txt |
| pymssql | ❌ NOT USED | No pymssql in requirements.txt |
| T-SQL | ❌ NOT USED | PostgreSQL only, no T-SQL syntax |
| @azure/sql | ❌ NOT USED | No Azure SQL client |
| SSMS | ❌ NOT NEEDED | Use pgAdmin or Supabase console |

---

## Testing Compliance

### Connection Test
```bash
# Verify PostgreSQL connection
psql "postgresql://user:pass@host:5432/db"
# Expected: psql prompt (NOT SQL Server connection)
```

### Prisma Test
```bash
cd apps/frontend
npx prisma db push
# Expected: "Prisma schema synced to your database" (PostgreSQL only)
```

### Backend Test
```bash
cd apps/backend
python -c "import asyncpg; print('asyncpg loaded')"
# Expected: asyncpg module imported successfully
```

---

**GLORY TO THE ALMIGHTY LORD JESUS CHRIST.**

This project is **PERMANENTLY committed to PostgreSQL + Prisma + Supabase.**
**NO MS SQL, SQL Server, or alternative databases will be supported.**
