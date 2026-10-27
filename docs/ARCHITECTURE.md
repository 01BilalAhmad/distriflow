# DistriFlow — Architecture Overview

> Yeh document skills-audit (Oct 2026) ke silsilay mein likha gaya hai taake naye
> engineers aur agents ko 10 minute mein poora system samajh aa jaye. Yahan sirf
> *jo hai* wo document kiya gaya hai — recommendations ke liye audit report dekhen.

## 1. Kya hai DistriFlow?

DistriFlow ek **multi-tenant Distribution Management System (DMS)** hai jo FMCG
distributors ke liye banaya gaya hai: order booking se lekar delivery, ledger,
recovery (cash collection), returns/claims, aur SKU-level profit reporting tak.
Ek hi deployment par kai distributors (tenants) ka data rehta hai, aur field
salesmen offline-first mobile flow use karte hain.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router, v16 line) — `output: "standalone"` |
| Language | TypeScript (strict-ish — dekhen audit note: `noImplicitAny` currently off) |
| Database / ORM | PostgreSQL (Neon) + Prisma 6 — `prisma/schema.prisma` (30 models) |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) |
| State/Fetching | Bare `fetch` wrapper (`src/lib/dms-api.ts`) — React Query installed magar unused |
| Auth | Custom HMAC-signed httpOnly cookie (`src/lib/auth-token.ts`) + `src/proxy.ts` page guard |
| Deployment | Vercel (`vercel.json`), standalone server self-host ke liye bhi |

## 3. Roles & Tenancy

- **MEGA_ADMIN** — platform-level admin; sab tenants dekh sakta hai (`/api/mega/*`)
- **DISTRIBUTOR** — ek tenant ka malik; apna network (outlets, products, schemes, staff) chalata hai
- **SALESMAN** (booker) — distributor ke under; apni route ke outlets par orders/recoveries book karta hai

Tenant scoping ka core helper `src/lib/dms-scope.ts` hai (`resolveScope`,
`distributorTenant`, `getTenantIdForSalesman`). Salesman apne `parentId` chain se
distributor tak bind hota hai.

## 4. Money Flow (sab se important path)

```
Order booking (POST /api/orders)
  └─ computeOrderLines()          ← src/lib/dms-order-calc.ts (PURE money math)
       3-unit conversion → scheme stack (Task 58) → GST base → manual discount merge
  └─ DeliverySummary process → van-out fulfillment (dms-fulfill.ts)
       └─ FEFO stock deduction (dms-inventory.ts) + Delivery doc numbering (nextSeq)
  └─ Settle (POST /api/summaries/[id]/settle)
       └─ OutletLedger postings + returns reversal (pro-rata tax/TO) + cash clamp
  └─ Recovery sheets (POST /api/recovery) → OutletLedger + Collection entries
```

**Design principles jo code comments mein documented hain:**
- *Server-authoritative pricing* — UI sirf preview mangta hai, final math sirf lib mein
- *Snapshot rates* (Task 41/45/56) — bill jis rate/scheme/GST par bana, edits par wahi re-apply hota hai
- *clientRef idempotency* — offline sync dobara chalne par duplicate na bane (unique constraints)
- *Task-numbered comments* — har business rule ke peeche "kyun" preserve hai

## 5. Offline Sync (field force)

- **Down** (`GET /api/sync/down`): salesman ko apni route ke shops, products, balances, pending orders ka snapshot milta hai
- **Up**: orders/recoveries/outlet-tags apne `clientRef` ke saath POST hote hain; server unique constraint se duplicates reject/reconcile karta hai
- Client-side cache: `src/lib/route-cache.ts` (localStorage snapshot — server cache NAHI)

## 6. Auth (current state — audit ke baad bhi dekhen)

- Login: `POST /api/auth/login` → `dms_auth` cookie = `u.<userId>.<hmac>`
- Page routes: `src/proxy.ts` cookie verify karta hai
- **API routes is guard se bahar hain** (matcher `api` exclude karta hai) — yehi
  audit ka sab se bara finding hai; planned fix ka ADR: `docs/adr/0002-*.md`

## 7. Directory Map

```
src/
├── app/
│   ├── (app)/            # auth'd pages — har page 9-line server component → feature view
│   ├── api/              # 72+ REST route handlers (audit: auth gaps dekhen)
│   ├── login/            # login page
│   └── layout.tsx
├── components/dms/       # feature views (orders-view, settlement-view, salesman-app, reports/...)
├── hooks/                # shared hooks (use-mobile etc.)
├── lib/
│   ├── db.ts             # Prisma client singleton
│   ├── auth-token.ts     # HMAC session token
│   ├── dms-order-calc.ts # PURE pricing math (unit-tested: *.test.ts)
│   ├── dms-inventory.ts  # FEFO / ATP
│   ├── dms-fulfill.ts    # van-out fulfillment
│   ├── dms-scope.ts      # tenant scoping + doc numbering (nextSeq) + jsonError
│   ├── dms-*.ts          # baqi business modules
│   └── excel-export.ts   # client-side XLSX export
└── proxy.ts              # page-route auth guard
```

## 8. Mazid Parhne ke liye

- `docs/TESTING.md` — test setup aur coverage roadmap
- `docs/RUNBOOK.md` — deploy, backups, schema changes, monitoring
- `docs/adr/` — architecture decisions
- `README.md` — quick start
