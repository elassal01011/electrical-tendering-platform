# Generic Excel extraction

The new `/excel` page is available from the existing application navigation. No deployment or database migration was performed.

## Architecture

`readWorkbook` now returns generic serializable workbook data. `loadWorkbook` retains the existing ExcelJS loader for business adapters. Both live in the repository's actual reader location, `src/lib/services/excel/readWorkbook.ts` (there was no `src/lib/excel/readWorkbook.ts`). The generic extraction module enumerates worksheets, preserves sparse cell positions and row numbers, identifies merges, serializes supported values, and detects headers without business aliases. Normalized rows use column letters as stable JSON keys so duplicate labels cannot overwrite values; original trimmed labels are stored separately.

The page supports sheet selection, automatic header detection with confidence, manual header correction, 30 useful preview rows, optional explicit alias suggestions, validation, Back buttons, and full selected-sheet JSON download. Preview succeeds before mapping validation. Existing BOQ and pricing adapters retain their separate business validation and database behavior.

## Storage and import scope

The existing authenticated, owner-scoped, chunked ExcelUpload infrastructure is reused. A nullable `extractedData` JSONB field stores the selected sheet's normalized rows, headers, original filename, upload ID, selected header, import type, mapping, creator, timestamp, cell type metadata and merges. Saving staging data writes an audit event. All seven requested import choices are exposed; business choices classify the staged data for later processing, rather than creating business records from arbitrary fields. Existing BOQ and pricing import pages remain the routes for business-record creation.

Staging retains the upload's existing 30-minute expiration and cleanup. Saving another sheet replaces that upload's staged selection. JSON download provides an independent copy for later processing. No permanent binary storage was added. Apply `prisma/migrations/20260906000000_generic_excel_staging/migration.sql` before using staging against a deployed database; it adds only the nullable JSONB column.

## Workbook coverage and limits

Supports normal XLSX workbooks with arbitrary or unknown fields, numeric and blank headers, duplicate labels, leading title/merged rows, multiple sheets, strings, numbers, booleans, dates, cached formulas, uncached formulas, rich text, hyperlinks and error cells. Empty sheets remain previewable. Trailing empty/style-only cells are excluded from extracted bounds. Uncached formulas retain formula type with null value; formulas are never evaluated. Dates are ISO strings with type metadata. Merge followers identify the master rather than duplicating its value.

Existing authentication, permissions, ZIP inspection, expanded-size checks, per-sheet row/column limits, file-size policy, upload ownership, expiry and cleanup remain in force. Legacy XLS is rejected with a save-as-XLSX instruction. Header detection is heuristic; use the manual header control for ambiguous or headerless data.

## Production TypeError investigation

The supplied log contains only `name: TypeError`; it does not establish the underlying cause. The existing checkout already called `Buffer.from(await file.arrayBuffer())`, and valid XLSX input parses in local tests. It would be inaccurate to claim the production root cause was proven or fixed.

The loader now explicitly imports Node Buffer, and Next.js externalizes ExcelJS to preserve its Node runtime implementation. A regression test verifies that ExcelJS receives an actual Node Buffer. Diagnostics include processing stage, error class, safe stage message, input constructor, Buffer status and byte length. Raw parser messages are deliberately not logged because they can contain workbook contents or secrets. A production reproduction or fuller safe trace is still required to confirm the original fault.

## Validation

- `npx prisma generate`: passed.
- `npx prisma validate`: passed.
- `npx tsc --noEmit --incremental false`: passed.
- `npm test`: 202 passed, 17 skipped; skipped tests require the dedicated opt-in database verification environment.
- `npm run build`: passed, including the `/excel` page and `/api/excel` endpoint.
- `git diff --check`: passed.

New extraction tests cover the requested workbook categories, serialization, duplicate labels, empty sheets, optional aliases and Buffer input. New API tests cover authorization, arbitrary previews, selected-sheet export, deferred mapping validation, invalid sheet/header messages and prevention of implicit mutations. Database staging was not exercised against a live database, and the authenticated UI has not received a browser interaction test.

## Files changed

- `next.config.js`
- `prisma/schema.prisma`
- `prisma/migrations/20260906000000_generic_excel_staging/migration.sql`
- `src/lib/services/excel/readWorkbook.ts`
- `src/lib/services/excel/extractWorkbook.ts`
- `src/lib/services/excel/importMapping.ts`
- `src/app/api/excel/route.ts`
- `src/app/excel/page.tsx`
- `src/app/api/boq/excel/import/route.ts`
- `src/app/api/boq/excel/preview/route.ts`
- `src/app/api/pricing/route.ts`
- `src/components/AppShell.tsx`
- `src/components/Sidebar.tsx`
- `src/components/boq/ExcelImportPanel.tsx`
- `src/middleware.ts`
- `tests/unit/readWorkbook.test.ts`
- `tests/unit/genericExcel.test.ts`
- `tests/unit/genericExcelApi.test.ts`
- `EXCEL-EXTRACTION-REPORT.md`
