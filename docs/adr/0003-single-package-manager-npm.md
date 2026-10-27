# ADR 0003 — Single Package Manager: npm

- **Status:** Proposed (audit Findings 2-c#19, 2-d#10 ka fix)
- **Date:** 2026-10-27
- **Deciders:** DistriFlow maintainers + skills audit recommendation

## Context

Repo mein **dono** lockfiles tracked hain: `bun.lock` (340 KB) aur
`package-lock.json` (354 KB) — lekin `package.json` mein koi `packageManager`
field nahi. README `npm install` kehta hai, `start` script `bun` runtime maangta
hai, Vercel auto-detection npm lockfile ko prefer karta hai. Natija: installs
non-reproducible (do resolvers disagree kar sakte hain), CI caching ambiguous,
aur `npm ci` vs `bun install` ka behavior farq.

## Decision

1. **npm canonical** package manager — kyunki Vercel deploy + CI dono `package-lock.json` use karte hain
2. `package.json` mein `"packageManager": "npm@<version>"` declare karein (manual edit)
3. `git rm --cached bun.lock` — bun sirf local convenience ke liye reh sakta hai magar lockfile commit nahi hoga
4. `start` script ka `bun .next/standalone/server.js` → `node .next/standalone/server.js` (standalone output Node-compatible hota hai) ya README mein bun-runtime requirement document karein
5. `.github/workflows/ci.yml` already `npm ci` use karta hai — koi change nahi

## Consequences

- Positive: reproducible installs, CI cache clean (`actions/setup-node` npm cache), Vercel parity
- Negative: bun-speed workflow istemal karne walon ko thora slow install — magar lockfile ek hi source of truth
