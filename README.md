# DistriFlow — FMCG Distribution Management System

**DistriFlow** is a multi-tenant Distribution Management System (DMS) built for FMCG distributors — from order booking on the field to delivery, recovery, and real-time reporting. One system for the distributor, their order bookers (salesmen), and the software seller (mega admin).

> Order booking se delivery tak — PJP route planning, geo-tagged outlets, FEFO inventory, schemes, claims aur powerful reports. Complete distribution chain ek jagah.

## Features

### Sales & Delivery
- **Order Booker App** — mobile-first order booking with **offline support** (orders queue and sync when back online)
- **Orders & Unprocessed Bills** — process / unprocess workflow with stock validation
- **Delivery Summaries** — CBL-format invoice printing (CTN / Box / Pcs, GST, advance tax, free-scheme columns), bulk "All Invoices" print, load form (load sheet) with pack breakdown
- **Settlement** — end-of-day settlement sheet per summary

### Finance
- **Shop Ledgers** — per-outlet ledger with statements and Excel export
- **Recovery (Wasooli)** — route sheets, booking-time recovery, admin approval flow, printable reports
- **Returns & Claims** — sale returns with tax reversal, claims tracking
- **Reports & Analytics** — day-wise sales, product performance, recovery and outstanding views

### Stock & Catalog
- **Inventory** — multi-warehouse, **batch-wise stock with FEFO** (first-expiry-first-out), near-expiry alerts, adjustments
- **Products & Brands** — per-tenant catalog with CTN/Box/Pcs pack structure, bulk import (CSV/Excel)
- **Schemes & Promotions** — percent / flat / BUY-X-GET-Y schemes plus order-level manual discounts

### Field Operations
- **PJP / Routes** — planned journey plans per salesman per day, check-in/check-out with GPS
- **Visit Map** — route check-ins plotted on OpenStreetMap: visit pins (pending / checked-in / completed / missed), route lines, and coverage stats
- **Outlets** — geo-tagged retailers with visit-day schedules, filer status (advance tax), bulk import
- **Field Force** — salesman management with targets and assignment

### Business Network & Platform
- **Companies (Procurement)** — supplier purchase invoices, payable ledger, **payment entry with invoice allocation**, supplier aging (0-30 / 31-60 / 61-90 / 90+ days)
- **My Network** — distributor hierarchy
- **Mega Admin Console** — multi-tenant: distributor account creation, subscription expiry/renewal; business data of tenants stays isolated at the API level
- **Backup & Safety** — one-click consistent SQLite backup (VACUUM INTO) with download, mega-admin only
- **FBR-style invoicing** — GST on/off (box vs pcs mode), advance tax (WHT) with filer/non-filer rates, NTN/CNIC on bills

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| State | Zustand |
| UI | Tailwind CSS 4 + shadcn/ui |
| DB / ORM | SQLite + Prisma |
| Maps | Leaflet + OpenStreetMap (no API key needed) |

## Getting Started

```bash
# 1. install
npm install

# 2. database (SQLite) — schema push + demo seed
npx prisma db push
npx prisma db seed

# 3. run
npm run dev
# open http://localhost:3000
```

### Demo Users

| Role | Email | Password | What it shows |
|---|---|---|---|
| Mega Admin | `admin@dms.pk` | `demo123` | Distributor accounts console (create / renew / deactivate) |
| Distributor | `distributor@dms.pk` | `demo123` | Al-Madina Distribution — full business: orders, invoices, ledgers, recovery |
| Salesman | `salesman@dms.pk` | `demo123` | Ali Raza — Order Booker App: PJP, booking, check-in, returns, recovery |

> Demo seed tenants are isolated — each distributor only ever sees their own catalog, orders and ledgers.

## Project Structure

```
src/
  app/api/          # REST API routes (orders, summaries, recovery, pjp, backup, ...)
  components/dms/   # Feature views + print templates (CBL invoice, load form, ledgers)
  lib/              # Tenant scoping, order calc, inventory (FEFO), settings, store
prisma/             # Schema + demo seed
db/                 # SQLite database (gitignored — never commit real data)
```

## Security Notes

- Tenant isolation is enforced **at the API layer** (mega admin cannot read tenant business data)
- `db/`, `.env`, uploads and internal scripts are gitignored — real business data never enters version control
- Session is a signed localStorage profile for the demo; swap in real auth before production use

## Roadmap

- [ ] SMS alerts (order delivered / payment received) — needs SMS gateway
- [ ] Live location tracking (ping-based)
- [ ] WhatsApp invoice sharing
- [ ] PostgreSQL support for hosted multi-instance deployments

---

Built with distribution-floor experience — routes, vans, bookers aur wasooli, sab is liye design me hai.
