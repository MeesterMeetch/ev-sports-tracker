---
name: Sharp book cascade
description: Current sharp reference cascade for EV math and the invariant tying SHARP_BOOKS to the fetched bookmakers list
---

**Current cascade (since July 2026):** Pinnacle → LowVig → BetOnline → Consensus. An earlier decision excluded Pinnacle as sharp ref, but live data showed Pinnacle prices are available on the user's Odds API plan, and an external code review recommended adding it as the top reference. The user approved applying that patch.

**Rule:** Every key in `SHARP_BOOKS` (ev-math) must also appear in the `bookmakers` param of the odds fetch. If a sharp book is not requested, the cascade silently falls through to Consensus — a self-referential EV signal — and spreads/totals get skipped entirely because they have no consensus fallback.

**Why:** This exact mismatch shipped to production: LowVig/BetOnline were in SHARP_BOOKS but never fetched, so every card showed "Sharp ref: Consensus" and the EV card was effectively h2h-only. No error is raised — the only symptom is `no_sharp_reference` warnings in logs and Consensus everywhere in the UI.

**How to apply:** When adding/removing a sharp book, change both the SHARP_BOOKS array and the bookmakers fetch param together, then hit the EV card and confirm `sharpBook` in the response shows the expected book, not Consensus. Also note: the EV route already skips the sharp source book when evaluating retail prices, so a book can safely be both sharp ref and retail candidate.
