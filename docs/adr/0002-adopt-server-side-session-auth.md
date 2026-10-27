# ADR 0002 — Adopt Server-Side Session Auth on All API Routes

- **Status:** Proposed (audit CRITICAL findings 2-a#1, #3, #5, #6 ka planned fix)
- **Date:** 2026-10-27
- **Deciders:** DistriFlow maintainers + skills audit recommendation

## Context

Security audit (Oct 2026) ne confirm kiya:

- `src/proxy.ts` ka auth guard sirf **page routes** par lagta hai; API matcher `/api` ko exclude karta hai
- 46+/72 API routes identity ke liye client-supplied `userId` (query/body) par bharosa karte hain
- `POST /api/auth/session` "legacy bridge" kisi bhi `userId` ke liye valid signed cookie mint karta hai — bina password
- `GET /api/backup/export?userId=<megaAdminId>` poori all-tenant database leak kar sakta hai
- Financial mutations (collections, settlements, returns/claims approval) anonymous ho sakte hain

Yeh OWASP A01:2021 (Broken Access Control) hai — multi-tenant financial system ke liye launch blocker.

## Decision

1. Ek shared helper **`requireUser(req)`** banaya jaye (`src/lib/dms-scope.ts` ya naya `src/lib/auth-guard.ts`) jo `dms_auth` cookie ko `verifyAuthToken` se verify kare aur `{ userId, user }` return kare — fail par 401
2. Har business route is helper se identity le — **`?userId=`/body `userId` sirf scope-filter** rahega jo session user ke allowed scope ke against validate hoga
3. Tenant/ownership guards (`distributorTenant` pattern) har mutating route par — cross-tenant writes block
4. Legacy bridge `POST /api/auth/session` delete — cookie sirf `POST /api/auth/login` (password verify ke baad) issue ho
5. `MEGA_ADMIN` checks verified session se derive hon, parameter se kabhi nahi

## Consequences

- Positive: IDOR/tenant-breach class khatam; audit trail par real identity; backup export secure
- Negative: **breaking change** — mobile booker app ka API contract badalta hai → API versioning (`/api/v1/`) sath mein plan karein; ~40 routes mein boilerplate badlega — is liye helper + codemod approach
- Migration path: pehle read-only sensitive routes (backup, sync/down, PII), phir mutations, phir baqi — har step par route-auth-gate tests (docs/TESTING.md #5)
