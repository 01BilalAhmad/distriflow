# ADR 0001 — Record Architecture Decisions

- **Status:** Accepted
- **Date:** 2026-10-27
- **Deciders:** DistriFlow maintainers

## Context

DistriFlow mein 86 se zyada "Task N" iterations ho chuki hain aur har business
rule ka rationale code comments mein mehfooz hai — magar **kyun** koi bada
architectural faisla kiya gaya (e.g. custom auth instead of a framework, offline
sync design, snapshot pricing), yeh kahin systematic record nahi hota. Naye
engineers aur AI agents ko context tribal knowledge se milta hai. Skills audit
(Oct 2026) ne documentation gaps ko highlight kiya.

## Decision

Hum **Architecture Decision Records** adopt karte hain — lightweight, numbered
markdown files is directory (`docs/adr/`) mein:

- Naya significant decision → nayi ADR file `NNNN-short-title.md`
- Format: Status / Date / Deciders / Context / Decision / Consequences
- Decisions immutable hain — badalne ke bajaye nayi ADR purani ko "Superseded by" mark karti hai
- PR review hi ADR review hai

## Consequences

- Positive: onboarding + agent context systematic ho jayega; "ye kyun aisa hai?" ka jawab git-searchable hoga
- Negative: thora process overhead — magar sirf *significant* decisions ke liye (naming, auth model, DB strategy), har PR ke liye nahi
