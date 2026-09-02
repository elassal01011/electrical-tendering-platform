# Architecture

## Layering

```
src/app/                  Next.js App Router — pages (UI) + api/ (routes)
src/lib/services/         Pure business logic, no framework/DB dependency
  matching/                 BOQ parser + component matching engine
  pricing/                  Cost/margin formulas
  calculations/              Engineering calculators (busbar, ...)
src/lib/auth/              NextAuth config, RBAC permission checks, API guard helper
src/lib/db/                 Prisma client singleton
src/components/            Shared UI components
prisma/                    Schema + seed script
tests/unit/                 Vitest tests for the services layer
```

The services layer is deliberately kept free of Prisma/Next.js imports so
it can be unit tested in isolation (see `tests/unit/*.test.ts`) and reused
from a future NestJS backend, worker process, or CLI if the project
outgrows Next.js API routes.

## Request flow example: BOQ import → match → panel → price

1. `POST /api/boq/import` — client sends raw BOQ rows (description, qty,
   unit). For each row, `parseBoqDescription()` extracts a structured
   spec, and a `BOQItem` is created with `status: UNMATCHED`.
2. `POST /api/boq/:id/match` — for every item, the catalog is loaded and
   `rankCandidates()` scores every active `Component` against the parsed
   spec. `autoSelectBestMatch()` decides whether to auto-commit the top
   match (only if it clears a confidence threshold AND has no
   under-rated/insufficient-breaking-capacity flag) or leave it as
   `SUGGESTED` with ranked alternatives for manual engineer selection.
3. A `PanelComponent` is created linking a `Component` to a `Panel` (this
   step is currently manual via `POST /api/panels/:id` — auto-creating
   panel BOM lines directly from matched BOQ items is a natural next
   extension, not yet wired).
4. `GET /api/panels/:id` computes a live pricing summary by loading each
   component's list price, finding the best applicable
   `SupplierDiscount`, and running `computePricingSummary()` — this is
   pure, testable arithmetic, not scattered across the UI.
5. `POST /api/quotes` snapshots a set of priced line items into a new
   `Quote` (or the next revision of an existing `quoteNumber` — revisions
   are additive, never overwritten).
6. `GET /api/export/excel?panelId=...` streams a formatted `.xlsx` using
   ExcelJS directly from the panel's current BOM.

## Why a rule-based BOQ parser instead of an LLM call

Determinism, speed, and explainability. Every match the engine makes
comes with a human-readable reason string (e.g. "Breaking capacity
INSUFFICIENT (25kA < required 36kA) — do not select"), which is required
by spec Section 10 ("Show match percentage and reason") and Section 49
("Every AI recommendation must show recommendation, confidence, reason,
engineer approval"). An LLM-based enrichment step (e.g. handling BOQ
phrasing the regex rules don't cover yet) is a legitimate future addition
but should sit *in front of* this parser as a normalizer, not replace the
explainable scoring engine itself.

## Safety rule implementation

Two places encode the "never silently make an unsafe engineering
substitution" requirement (spec Sections 23 & 58):

- `componentMatcher.ts` → `autoSelectBestMatch()` refuses to return a
  match whose reasons include an under-rated current or insufficient
  breaking capacity flag, regardless of its numeric score.
- `busbarCalculator.ts` (and the `EngineeringCalculation` table generally)
  — every calculation is persisted with `status: PRELIMINARY` and must be
  explicitly promoted to `ENGINEER_VERIFIED` / `APPROVED` by a human. No
  UI or API path in this build flips that status automatically.

## Extension points

- `ERPAdapter` interface (Section 33) — not yet created as code, but the
  `InventoryItem` / `PurchaseOrder` tables are shaped to support it.
  Add `src/lib/services/erp/ERPAdapter.ts` with a `MockAdapter`
  implementation as the first step.
- AI layer (Section 49) — should call into `boqParser.ts`'s output shape
  (`ParsedSpec`) so it can be swapped in without touching the matching
  engine's scoring logic.
- Additional engineering calculators (enclosure sizing, thermal) follow
  the exact pattern of `busbarCalculator.ts` + the `/api/panels/:id/calculate`
  route — same input validation, same `PRELIMINARY` tagging.
