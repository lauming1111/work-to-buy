# AGENTS.md

Guidance for AI coding agents working in this repo.

## Project

**Work Record Keeper** — a client-only SPA where a user records daily work hours, sees after-tax
earnings (Ontario/Canada-style deductions), keeps roster images, and tracks progress toward a
list of things they want to buy. No backend, no API calls: everything lives in `localStorage`
and can be exported/imported as JSON.

Deployed to GitHub Pages at `https://lauming1111.github.io/work-to-buy` (see `homepage` in
`package.json` — it drives the asset base path, don't change it casually).

## Stack

- React 19 + TypeScript 4.9, bootstrapped with Create React App (`react-scripts` 5).
- `antd` — used only for `TimePicker` (24h time entry).
- `dayjs` (+ `customParseFormat`) for time parsing/formatting.
- Plain hand-written CSS in `src/App.css` and `src/index.css`.
- `standard-version` for releases, driven by Conventional Commits.

Tailwind, PostCSS and autoprefixer are installed and `tailwind.config.js` exists, but **no
`@tailwind` directives are present in any stylesheet** — Tailwind is effectively unused. Do not
write Tailwind utility classes expecting them to work; either add the directives deliberately
first, or stay with plain CSS.

## Commands

```sh
npm install
npm start        # dev server, http://localhost:3000
npm test         # CRA/Jest watch mode
npm run build    # production build into build/
npm run deploy   # predeploy builds, then gh-pages -d build
npm run release  # standard-version: bump version, update CHANGELOG.md, tag
```

`CI=true npm run build` turns lint warnings into errors and **currently fails on pre-existing
issues** (BOM in `src/App.tsx`, unused `Dayjs` / `clearAll` / `CustomTimeInput` / `zoomInRoster`,
a missing `alt`, one `react-hooks/exhaustive-deps`). Plain `npm run build` succeeds. Don't treat
those as regressions from your change — but don't add new ones either.

## Layout

```
src/App.tsx        the whole UI: state, calendar, roster, tables, i18n labels
src/calc.ts        pure pay/tax math and multi-job aggregation — no React, no localStorage
src/storage.ts     the localStorage layer: keys, per-job reads/writes, legacy fallbacks
src/App.css        all component styling, incl. dark mode and mobile breakpoints
src/index.css      global resets
src/App.test.tsx   component tests (jsdom, RTL)
src/calc.test.ts   unit tests for the pay math and job aggregation
src/storage.test.ts unit tests for the storage layer
src/setupTests.ts  jest-dom + matchMedia / ResizeObserver stubs for antd
public/            static assets, manifest, favicon (favicon may be tracked via Git LFS)
```

`src/App.tsx` is deliberately one large component. Don't split it into a component tree as a
drive-by refactor; only do so if the user asks. **New calculation logic belongs in `calc.ts`
and new persistence in `storage.ts`**, so it can be unit tested without rendering.

`src/App.tsx` starts with a UTF-8 BOM. Preserve it when rewriting the file.

## Domain model

Types live in `src/calc.ts`:

- `Item` — a thing to buy: `{ id, name, price, taxable, enabled }`.
- `DayHours` — one calendar day: `date` (`YYYY-MM-DD`), optional `start`/`end` (`HH:MM`),
  computed `hours`, `lunchMinutes`, and `originalHours` (pre-lunch-deduction value).
- `DetailedDay` — per-day computed result: gross `earnings`, `incomeTax`,
  `employeeInsurance`, `cpp`, `afterTax`.
- `JobMeta` — `{ id, name }`; the app supports multiple jobs, each with isolated storage.
- `PaymentCycle` — `"biweekly" | "semi-monthly" | "monthly"`, per job.
- `RosterData` — `{ weekly, monthly }`, each a map of period key → compressed image data URL.
- `JobCalcInput` / `JobEarnings` / `AllJobsSummary` — the multi-job aggregation shapes.
- `JobExport` / `AllJobsExport` — the JSON import/export shapes. `AllJobsExport` is versioned
  (`type: "w2b_all_jobs"`, `version: 1`); bump and handle the old version if you change it.

### Legacy-data rules (easy to break)

- `getLunchMinutes` falls back to the legacy boolean `lunch` field, then to
  `DEFAULT_LUNCH_MINUTES` (30). A missing `lunchMinutes` means 30, **not** 0.
- `getOriginalHours` reconstructs pre-lunch hours for old entries that only stored `hours`.
- `readJobStorage` reads the job-scoped key first, then falls back to the pre-multi-job
  `LEGACY_STORAGE_KEYS` — but only for `DEFAULT_JOB_ID` (`"default"`).

Keep all three fallbacks intact unless the user explicitly wants to drop old data.

## Calculation rules

Payroll constants in `src/calc.ts` (hard-coded, not configurable in the UI):

| Constant | Value | Meaning |
| --- | --- | --- |
| `BIWEEKLY_BONUS_RATE` | 0.04 | 4% vacation pay, applied to every hour |
| `WEEKLY_OVERTIME_THRESHOLD` | 44 | hours/week before overtime |
| `OVERTIME_MULTIPLIER` | 1.5 | overtime rate |
| `BIWEEKLY_TAXFREE_THRESHOLD` | 88 | only used by the "unlawful" rule below |
| `DEFAULT_LUNCH_MINUTES` | 30 | default lunch deduction |

### Tax and payroll deductions

Rates live in `src/tax.ts`, keyed by calendar year (`TAX_YEARS`, currently 2025 and 2026).
`getTaxYearRates(year)` clamps unknown years to the nearest entry, so old records still price.
Each year holds federal and Ontario brackets, both basic personal amounts, the Canada
employment amount, the Ontario surtax, tax reduction and health premium bands, CPP
(rate, $3,500 exemption, YMPE, CPP2 rate, YAMPE), EI (rate, maximum insurable earnings), and
`salesTax` — Ontario HST, used for shopping-list items and **not** a payroll rate. Add a new
year each January rather than leaning on the clamp; verify every figure against CRA's T4127.

Deductions follow the shape of CRA's T4127 formulas and are computed **per pay period**, not
per day: annualize the period's taxable pay, apply the year's brackets and credits, divide
back down, then spread the result across the period's days in proportion to their taxable
earnings. Annual caps (YMPE, YAMPE, maximum insurable earnings) are tracked year-to-date and
reset each calendar year; they are tracked per job, which is correct, because the annual
maximums restart with each employer. A period's tax year comes from its **end** date, so a
period straddling New Year is priced consistently.

These are withholding figures. Refundable credits settled at filing — the Ontario LIFT credit
and the Canada Workers Benefit — are deliberately absent, exactly as they are absent from
T4127, so a low earner's real year-end tax is lower than the total withheld here.

`computeDetailedDays` prices one job's days. Two payroll modes:

- **Default (lawful):** hours past 44 in a week are paid at 1.5x; everything is taxable.
- **"Unlawful" mode**, active only when the job's name is exactly `"3495"`
  (`isUnlawfulRuleJob`): no overtime multiplier; instead, hours beyond 88 in a bi-week are
  treated as untaxed, distributed pro-rata across the days of that bi-week. The details table
  also relabels its columns in this mode.

That magic string is intentional. Don't "clean it up" without asking.

Weeks and bi-weeks are indexed by day offset from the job's `startDate` (`getIndexInfo` →
`Math.floor(diffDays / 7)` and `/ 14`), not by calendar week. That offset counts whole
calendar days via `Date.UTC`; subtracting raw timestamps is an hour short across a
daylight-saving change and shifts every later date into the wrong week and pay period. Date strings are parsed with
`parseYmdLocal` (local midnight) — do **not** use `new Date("YYYY-MM-DD")`, which is UTC and
shifts the day. `getTorontoToday()` anchors "today" to Toronto time.

## Layout and responsiveness

`src/App.css` is **mobile-first**. Base rules target a phone; two `min-width`
queries layer on top — `700px` (tablet) and `1100px` (desktop). Keep it that way.
Do not add `max-width` queries or `!important`: the stylesheet this replaced was
desktop-first with twenty overlapping queries at six breakpoints, nine competing
`grid-template-columns` on `.cal-grid`, and `!important` wars between them.

Design tokens live in `:root` — `--s1`..`--s5` spacing, `--fs-xs`..`--fs-lg` type,
`--r1`..`--r3` radii. Use them instead of new magic numbers. `--fs-input` is 16px
and must stay at least that: anything smaller makes iOS zoom the page on focus.

`useIsNarrow()` in `App.tsx` mirrors the 700px breakpoint in JS for the two places
markup has to differ, not just styling. It listens to both the media query and
`resize`, because some environments resize without firing the query's change event.

- **Calendar.** Below 700px each `.cal-cell` is a compact tap target showing only
  day number, hours and pay; tapping it opens the `.day-sheet` bottom sheet.
  Above, the same controls render inline in the cell. Both come from one
  `renderDayControls(dateStr)`, so add day inputs there and they appear in both.
- **Wide tables.** `.stack-table` (the period summary and details tables) turns
  each row into a labelled card below 700px, reading the column name from each
  cell's `data-label`. **Every `<td>` in those tables needs a `data-label`** or it
  renders unlabelled on phones. Above 700px they revert to normal tables.
- The measured `weekRowTemplate` that aligns roster rows to calendar rows is
  skipped on phones — the roster stacks below the calendar there, and applying
  compact cell heights to it made the roster items overlap.

`payCycle` (`biweekly` | `semi-monthly` | `monthly`) sets the deduction period: it decides how
the CPP basic exemption is prorated and what income is annualized, so it does change the
numbers. `getPeriodInfo`/`getPeriodKey` in `calc.ts` do the bucketing; the summary table's own
`getSemiMonthlyInfo`/`getMonthlyInfo` helpers produce the same buckets plus display labels.
Gross pay itself (overtime, vacation pay) is unaffected by the cycle.

### Multiple jobs

`summarizeJobs(JobCalcInput[])` prices every job on **its own** hourly rate, start date and
payroll rule, then sums hours, gross and after-tax. In `App.tsx` the active job is fed from
live state and the others from `loadJobData`, so unsaved edits show up immediately. The
`combineJobs` toggle (persisted at `w2b_combineJobs`) decides whether the buy-list progress bar
counts the active job alone or every job. The item list itself stays per job.

## Storage keys

- `w2b_jobs`, `w2b_activeJob`, `w2b_dark`, `w2b_combineJobs`
- Per job: `w2b_job_<jobId>_<items|hourlyRate|dayHours|startDate|currentDate|payCycle|roster>`
- Legacy (default job only): `w2b_items`, `w2b_hourlyRate`, `w2b_history`, `w2b_startDate`,
  `w2b_currentDate`, `w2b_payCycle`, `w2b_roster`

Every piece of state is persisted through a `useEffect` keyed on `activeJobId`. If you add
persisted state, add the write effect, the read path in `loadJobData`, and the key in
`LEGACY_STORAGE_KEYS` so `clearJobStorage` picks it up.

Roster images are compressed client-side (WebP, JPEG fallback; smaller/lower quality on mobile
user agents) before being stored as data URLs — they are the main quota risk. All writes go
through `safeSetItem`, which swallows quota errors so a full `localStorage` never crashes the
app. Use it instead of `localStorage.setItem` directly.

## i18n

A single `labels` object inside the component holds `en` and `zh-tw` maps; the UI reads
`labels[lang].<key>`. **Both maps must be updated together** — a key present in one and missing
in the other renders `undefined`. Language is component state only, not persisted.

## Dark mode

`darkMode` state persists to `w2b_dark` and toggles a `dark` class on both `document.body` and
`document.documentElement`, plus a `dark`/`light` class on the root container. CSS for dark mode
lives in `src/App.css`.

## Testing

Cover every change with tests — the user asks for this on all work in this repo.

- Pay math, aggregation and storage go in `calc.test.ts` / `storage.test.ts` as plain unit
  tests. Prefer these: they run in milliseconds and need no DOM.
- UI behaviour goes in `App.test.tsx` with React Testing Library. `beforeEach` clears
  `localStorage`; seed per-job keys with `jobStorageKey` before rendering.
- Job names appear both in the job tabs and in the all-jobs table, so scope name queries
  (`within(document.querySelector(".job-tabs"))`) rather than using a bare `getByText`.
- Money assertions are exact strings (`"$135.08"`). `round2` rounds every stored figure, so
  compare sums with `toBeCloseTo` rather than raw float arithmetic.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `style:`, `doc:`/`docs:`) — `standard-version`
  generates `CHANGELOG.md` from them. Don't hand-edit `CHANGELOG.md` or the `version` field in
  `package.json`; run `npm run release`.
- Money is rounded with `round2`; use it rather than ad-hoc `toFixed` arithmetic.
- Dates as strings are always `YYYY-MM-DD` (`ymd()`).
- JSON read from `localStorage` or an import file goes through `safeParse`.

## Known rough edges

- Tailwind is configured but inert (see Stack).
- Tax rates are hard-coded per year in `src/tax.ts` with no UI to change them, and no year
  past the newest table entry is real — it silently clamps.
- Only the credits every hourly employee has are modelled. Dependants, tuition and the TD1
  "other credits" box are not, so anyone claiming those has less tax withheld than shown.
- `CI=true npm run build` fails on pre-existing lint issues (see Commands).
- `tsconfig.json` targets ES5 without `downlevelIteration`, so spreading a
  `NodeList` (`[...el.querySelectorAll(..)]`) compiles under Jest but breaks
  `npm run build`. Use `Array.from(..)`.
- The app displays a disclaimer that results may vary; it's an estimator, not payroll software.
  Keep that framing in any user-facing copy.
