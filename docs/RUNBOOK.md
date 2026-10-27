# DistriFlow — Operations Runbook

> Production deployment, backups, schema changes aur monitoring ke liye
> practical guide. Audit findings jin ka yeh runbook direct fix hai, unke
> references (e.g. `2-d#8`) audit report se link kiye gaye hain.

## 1. Environment Variables

| Var | Zaroori? | Kya karta hai | Note |
|---|---|---|---|
| `DATABASE_URL` | Haan | Postgres (Neon) connection | `.env.example` dekhen |
| `AUTH_SECRET` | **Production mein CRITICAL** | Session cookie ka HMAC secret | Agar set nahi to hardcoded fallback use hota hai → cookie forgery possible (audit CRITICAL #7). Generate: `openssl rand -hex 32` |

Template: `.env.example` ko `.env` mein copy karein. Real `.env` kabhi commit na karein.

## 2. Deploy (Vercel)

- `vercel.json` build: `prisma generate && next build`
- Node 22 pin: `.nvmrc` (CI isi se install karta hai)
- Vercel dashboard mein **Environment Variables** set karein: `DATABASE_URL`, `AUTH_SECRET`

### Task 95 schema deploy (one-time)
Task 95 ne indexes (~45), `Counter` table aur User lock fields add kiye. Deploy ke
baad EK dafa chalayein (local se prod DATABASE_URL ke sath):

```bash
DATABASE_URL="<prod-url>" npx prisma db push   # --accept-data-loss ke bagair — additive-only changes
```

`Counter` rows khud seed ho jati hain (pehli nextSeq call par legacy max se).

## 3. Database Schema Changes — KHATRE ka note

`package.json` mein `db:push` script `--accept-data-loss` ke saath hai (audit
HIGH 2-d#8). Live financial data par yeh columns/tables **silently drop** kar
sakta hai. Recommended workflow:

```bash
# Dev mein:
npx prisma migrate dev --name <change-name>   # migration file banti hai, git mein commit hoti hai

# Production/preview mein:
npx prisma migrate deploy                      # sirf approved migrations chalti hain
```

Aur backups pehle verify karein (section 4) — migration galat ho to restore possible ho.

## 4. Backups

- **Neon PITR** (point-in-time restore) enabled hai ya nahi — Neon dashboard se confirm karein aur yahan likh dein: `[ ] PITR verified — <date>`
- Manual export: `GET /api/backup/export` (MEGA_ADMIN only) — poora DB JSON mein. NOTE: yeh request memory-heavy hai (audit 2-b#15) — production data par scheduled `pg_dump`/Neon snapshots behtar hain
- **Restore drill**: saal mein kam az kam ek dafa staged restore test karein (backup jo kabhi test na hua, wo backup nahi hai)

## 5. Health & Monitoring

- **Health endpoint**: `GET /api/health` → 200 `{status:'ok', db:'up'}` ya 503 `{status:'degraded'}`
- Uptime monitor (BetterStack/UptimeRobot etc.) isi URL par lagayein — 2 minute interval
- Abhi structured logging nahi hai (audit HIGH 2-d#7) — jab tak Sentry/pino nahi aata, Vercel logs + `console.error` hi source of truth hain

## 6. Incident Cheat-Sheet

| Symptom | Pehla qadam |
|---|---|
| "Bill total galat" report | Order ka `schemeStack` snapshot dekhen → `dms-order-calc` ke tests chalayein |
| Duplicate doc numbers (ORD-/RCP-) | Concurrency + `nextSeq` (audit CRITICAL 2-b#1) — do orders ka timestamp compare karein |
| Sync fail (booker app) | `/api/sync/down` response size + shop count dekhen (audit HIGH 2-b#4 — payload growth) |
| Login slow/failures | Rate limiting absent hai (audit) — Vercel WAF rules temporarily enable karein |

## 7. Repo Hygiene (audit se related)

- `dev.log` / `server.log` repo root mein bante hain (tee pipes) — commit na karein (gitignore covered)
- `download/`, `.zscripts/` tracked-junk cleanup audit report Finding 2-c#20 mein hai
- Ek package manager rakhein — `docs/adr/0003-single-package-manager-npm.md`
