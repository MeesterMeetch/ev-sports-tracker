---
name: Tailwind v4 dropped v3 CSS-var shorthand
description: Silent styling failures from [--var] arbitrary values in shadcn components under Tailwind v4
---

The rule: under Tailwind v4 (this repo pins ^4.1.x via catalog), the v3 arbitrary-value *reference* shorthand `prop-[--some-var]` compiles to nothing — silently. Use the v4 parenthesis syntax `prop-(--some-var)` or `prop-[var(--some-var)]`. Variable *declarations* like `[--cell-size:2rem]` are still valid v4 syntax and must NOT be converted.

**Why:** Stock shadcn/ui components shipped with v3 shorthands (e.g. `max-h-[--radix-select-content-available-height]` on SelectContent). Under v4 the class emitted no CSS, so Select dropdowns had no max-height and could not scroll — long lists (48 sports) were unreachable below the fold. Same class of bug existed in tooltip/popover/dropdown-menu/context-menu/menubar/hover-card (transform origins) and calendar/chart (`h-[--cell-size]`, `border-[--color-border]`).

**How to apply:** When adding new shadcn components to any artifact (each artifact has its own copy under `src/components/ui/`), check for `\[--` patterns and convert references to `(--var)`. A safe conversion is `s/\[(--[a-z][a-z0-9-]*)\]/(\1)/g` — it only matches bare references (no colon), leaving declarations and `data-[...]` selectors untouched. Verify via the dev server: `curl 'localhost:80/src/index.css?direct' | grep <var-name>` should show the emitted rule.
