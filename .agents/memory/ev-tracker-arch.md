---
name: EV Sports Tracker architecture
description: Key decisions and conventions for the EV betting analysis platform
---

## Stack
React+Vite (artifacts/ev-tracker at /), Express 5 (artifacts/api-server at /api), PostgreSQL + Drizzle ORM (lib/db), Zod + Orval codegen from OpenAPI spec (lib/api-spec).

## Key conventions
- Always update lib/api-spec/openapi.yaml first, then run codegen, then update routes + UI
- Codegen command: `pnpm --filter @workspace/api-spec run codegen`
- DB migration: `pnpm --filter @workspace/db run push`
- americanToImpliedProb is in artifacts/api-server/src/lib/ev-math.ts
- ODDS_API_KEY is the working key (20K plan). Never touch ODDS_API_KEY_V2.
- Replit Google Mail connector has gmail.send scope only (no read)

## CLV tracking
- closingOdds (integer) + clvPercent (numeric) added to bets table
- CLV formula: (closingImpliedProb - yourImpliedProb) * 100; positive = beat the market
- PATCH /api/bets/:id accepts closingOdds, auto-computes clvPercent server-side

## Freshness
- lineAgeMinutes added to EvBet response; computed from bookie.last_update in odds route
- FreshnessBadge shows amber warning on cards where lineAgeMinutes > 120 (2h rule)
