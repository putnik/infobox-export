# Changelog

All notable changes in this fork relative to the upstream
[putnik/infobox-export](https://github.com/putnik/infobox-export).

## [5.0.0]

Forked from upstream 4.2.0.

### Architecture
- Rewrote the UI on **Vue 3 + Wikimedia Codex** (loaded via ResourceLoader),
  replacing the old custom dialog. Render-function components, no SFCs.
- Build is **TypeScript (ES2017) → webpack production bundle**

### Awards (P166) 
- **Multi-value export**: a field listing several awards exports each as its own statement instead of only the first.
- **Export straight from a Qid** via `data-wikidata-value-id`, bypassing
  title→item guessing (immune to redirects/disambiguation).
- **Missing-date enrichment**: when an award already exists on Wikidata without a date but the article supplies one, the date is added to the existing statement (`wbsetqualifier`) rather than creating a duplicate. Shown with an "add missing date" pill.
- **Precision upgrade**: if Wikidata has only a year (e.g. 1985) and the article has a full date (01.01.1985), the coarser date is replaced in place via the snak hash. Shown with a "more precise date" pill. Skipped when ambiguous (two same-year awards).
- **Split a multi-date value** into separate statements when one value lists
  several dates.
- **Split qualifiers**: when a single statement carries several of the same date qualifier (e.g. Order of Lenin with five P585 dates), offer to split them into five separate statements.
- **Deprecated statements are now counted**, so existing values aren't added a second time.

### Dates & values
- Parse **DD/MM/YYYY** (and DD.MM.YYYY) dates.
- Numeric **"children"** value now exports to **number of children (P1971)**.
- **`?` and dashes** are treated as **unknown value** (`somevalue`).
- Exact field value **`нет`** exports as **no value** (`novalue`).

### Sourcing / references
- **Date-only exports are now sourced**: adding a missing/precise date also
  attaches the import reference (P4656 import URL, P143 imported-from) to the existing claim.
- A reference that already exists on the claim is **silently skipped** instead of failing the export (handles the "already has a reference with hash …" case), which also prevents that error from aborting the rest of the batch.

### Place of birth / death
- **P19 / P20 auto-select only the top candidate**; additional parsed values stay listed and can be checked manually, but are unchecked by default.

### Links
- **Plain-text redirect titles are resolved** (e.g. bare "Петроград" →
  "Санкт-Петербург"), matching the behaviour already applied to wiki links;
  any parenthetical date carries onto the resolved target.

### UI / UX
- **Dialog queue** so multiple exports don't stack on top of each other.
- **Deletable qualifier pills** — click to exclude a qualifier from the export.
- **Select-all / unselect-all** control per dialog.
- **Live progress** while exporting: Codex spinner + static "N/total exporting…".
- Exportable cards (new values and date-only enrichments) share one background.

### Fixes
- Non-Commons inline images no longer wrongly highlighted as missing-on-Wikidata.