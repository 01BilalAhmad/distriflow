# DistriFlow — Testing Guide

> Audit (Oct 2026) ne confirm kiya ke 72 API routes aur pure money-math par
> **zero tests** the. Yeh guide minimum viable test setup deti hai jo bina kisi
> existing file ke badle ready hai.

## 1. Setup — DONE (Task 95)

Vitest ab **installed devDependency hai** + `test`/`test:watch` scripts package.json
mein mojood hain. Bas chalayein:

```bash
npm test        # 39 unit tests (dms-order-calc 28 + auth-token 11)
npm run test:watch
```

CI (`.github/workflows/ci.yml`) ka `test` job ab **hard blocking gate** hai —
Task 95 ne continue-on-error flags hata diye (lint/typecheck/build bhi blocking).

## 2. Abhi kya covered hai?

| Test file | Target | Kya pin kiya gaya hai |
|---|---|---|
| `src/lib/dms-order-calc.test.ts` | `dms-order-calc.ts` (449 lines pure math) | 3-unit conversion, scheme full-stack (Task 58), GST base rule (Task 45), BxGy thresholds, frozen stack re-apply (Task 56), manual discount merge + cap (Task 52), grand payable rounding |
| `src/lib/auth-token.test.ts` | `auth-token.ts` | Roundtrip, tamper/malformed rejection, cookie flags |

Yeh dono modules **pure** hain (koi DB import nahi) — is liye zero mocking.

## 3. Agle 5 tests (priority order — audit 2-d)

1. ✅ **`dms-order-calc.ts`** — done (upar)
2. **`dms-live-recalc.ts` → `liveRecalcFromParts`** (pure) — CONFIRMED bill current schemes se re-price hota hai, processed bills frozen rehte hain, manual discount naye subtotal se re-derive
3. **`auth-token.ts`** — done (upar)
4. **`dms-inventory.ts` + `dms-fulfill.ts`** — FEFO expiry-then-received order, partial deduction across batches, shortfall "actually deducted" return, ATP = onHand − committed (PROCESSING excluded). Mock: `vi.mock('@/lib/db')` — saare modules ek hi alias import karte hain
5. **Route auth gates** — `auth/session`, `sync/down`, `backup/export`: role matrix (MEGA_ADMIN/DISTRIBUTOR/SALESMAN), inactive/expired distributor 403, non-admin 403. Jab tak server-side session auth (ADR 0002) land nahi hota, yeh tests current behavior *document* karte hain

## 4. Conventions

- Tests **colocated** rahen: `src/lib/foo.test.ts` (`.gitignore` mein purana bare `test`/`/tests/` pattern hai — `src/` ke andar kuch nahi chhupta, magar repo-root `tests/` folder banao ge to silently ignore ho jayega!)
- Pure functions ko pehle target karein; DB-touching code ke liye ek hi shared mock: `vi.mock('@/lib/db')`
- Money assertions hamesha `toBeCloseTo(x, 2)` — engine 2-dp rounding karta hai
- Naya business rule (Task N) aaye to uska pehla commit test hona chahiye — TDD skill ka red-green-refactor loop
