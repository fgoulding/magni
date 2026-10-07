# Magni history and progress audit

The user requested a system audit and a practical improvement roadmap, with historical tracking and visible progress as a priority. This task audits the current behavior and proposes changes; it does not implement or deploy application changes.

## Baseline and scope

- Fetched remote on October 6, 2026. Local HEAD and origin/main match `bb89149d29bf88509d011c76424c7ea63f512ea8`, with zero divergence.
- Four preexisting untracked September 5 plans are preserved. Production data and deployment remain untouched.
- Preserve the simple Today screen, readable week calendar, and desktop program editor. Favor a coherent history and progress experience over additional unrelated features.
- Root coordinates and owns this report plus disposable runtime evidence. Backend owns the data-contract audit; designer owns primary-source research and product hierarchy; verification independently owns workflow, export, accessibility and test coverage findings. All delegates are read-only.

## Recommendation

Make the next milestone reliable history and a connected Progress experience. A useful path is **Progress overview → exercise → actual set → exact workout**, with searchable History in the same navigation section. Keep Today focused on logging, with a small previous-performance link, and keep program authoring on desktop.

The system already preserves frozen prescriptions, actual results, correction records, and progression decisions. Those are valuable foundations. The main problems are inconsistent interpretation and limited access to the evidence. Correct those first; richer graphs should then use the same definitions as History and export.

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Repair existing Stats cards | Smallest scope; resolves misleading values | Leaves history discovery fragmented | Include these repairs in the first delivery |
| Connected Progress and History | Makes records searchable, comparable and traceable | Requires a shared analytics contract and exercise identity work | Recommended direction |
| Configurable dashboard | Many custom views | More controls and metric choices before the foundations are settled | Defer |

## Findings that affect trust

### CSV export includes work that was not recorded

**Priority P1. Confirmed by executing the existing export handler with synthetic data.** The export query substitutes prescribed reps and weight when actuals are absent, then exports every set in a completed workout. Its columns omit the session unit. A completed workout with one logged set and one unlogged set therefore exports both as numerical results. Legacy rows representing several sets also lack a multiplicity column. The program name comes from the current program join rather than the saved historical name, so archived/changed program context can be inconsistent.

Evidence: `src/app/api/export/route.ts:19,40–50`. Fix performed-versus-prescribed separation; include original units, session/set identifiers, legacy multiplicity, and saved workout/program context. Null actuals must stay null or be explicitly excluded from a performed-only export. Offer prescribed values in separately named columns when useful.

### Two workouts on one date collapse into one lift session

**Priority P2. Confirmed at runtime.** Lift detail groups by date and calls the number of dates “Sessions.” Two separate workouts on the same day become one combined entry with summed sets and volume. This finding concerns lift detail; it does not show that the overall workout total is wrong.

Evidence: `src/features/programs/training-stats.ts:288–365`, `src/components/LiftDetailContent.tsx:39`. Carry session and set IDs through analytics. Show each workout separately; use a daily aggregate only when it is explicitly labelled as such.

### Stats and Calendar use different week definitions

**Priority P2. Confirmed in source; Stats Sunday boundary executed.** Stats uses server-local current date and Sunday-start weeks. Calendar uses the user's timezone and Monday-start weeks. “This week” can therefore mean different periods across screens, particularly on Sunday or near a timezone boundary.

Evidence: `src/features/programs/training-stats.ts:66,519`, `src/app/calendar/page.tsx:231,275`. Use a shared user-local date and week-window contract. The current Calendar Monday boundary was checked in source, not through a rendered browser.

### Historical personal records change meaning after later workouts

**Priority P2. Confirmed semantic inconsistency at runtime.** The session PR function compares against all other completed workouts, including later dates; the lift timeline builds chronological records. After 100, 110, then 120, the middle workout loses its session PR result even though the timeline still treats 110 as a record earned then. Current tests encode the all-other-workouts behavior, so this requires an intentional contract change rather than only changing a test expectation. The prior-performance lookup can also select a workout later than a backdated workout being viewed.

Evidence: `src/features/programs/training-stats.ts:331,440–459,781`, `src/features/workouts/history-service.test.ts:132`. Distinguish **record earned then**, **current all-time best**, and **previous comparable workout**. Define ordering by performed date with a deterministic tie-breaker; the stored data cannot reconstruct an unknown within-day chronology. Document what a backdated correction does to derived achievements.

### Bodyweight and prehab progress is poorly represented

**Priority P1 for the user's intended training. Confirmed lift-detail exclusion at runtime.** A recorded zero-load exercise is excluded from lift detail, even with positive reps. This does not mean the workout or its overall rep/set totals were deleted. It means the current lift-progress view is unsuitable for important parts of bodyweight or band training.

Evidence: `src/features/programs/training-stats.ts:290,387`. Always retain recorded attempts in exercise history. Show reps, sets, target attainment and consistency where external load is not a useful metric. Band identity and resistance should be explicitly recorded if added; a band color must not silently become an invented weight. Optional actual effort can be considered later without making the normal logger busier.

### Display names are not dependable exercise identities

**Priority P1 architectural gap before cross-program comparisons. Source-confirmed.** Overview and PR queries partition by case-sensitive name while detail matches without case sensitivity. Renaming can split history; unrelated variations sharing a name can merge. Existing program progression keys and quick-workout exercise keys serve different purposes and are not a durable, cross-program exercise identity.

Evidence: `src/features/programs/training-stats.ts:391,415,585`, `src/features/workouts/history-service.ts:82`, `src/features/program-editor/migration.ts:30`. Add a user-owned exercise identity and explicit variant/alias mapping, preserving saved historical labels. Keep analytics identity separate from shared progression. Existing data should remain usable with clearly identified legacy groupings; do not automatically merge similar names. Any later mapping should be reversible and should not rewrite prescriptions or progression events.

## Improvements to the experience

1. **A Progress home with Overview and History.** Rename Stats to Progress while preserving existing links. History should remain within the active navigation section; currently `/workouts` has no selected bottom tab. Put the selected period and a short activity summary above a searchable list of all logged exercises. Preserve filters and scroll position when returning from a workout.
2. **Exercise pages that answer whether performance changed.** Lead with the latest actual set and date, a previous comparable result, and clear records. Example: “40 lb × 12; previously 40 lb × 10.” Add 4-week, 12-week and all-history views. Show dated points and original units; each point or historical row opens its exact workout. Keep a short summary beside the chart and accessible values below it.
3. **History that can be searched and followed back.** Add exercise/workout search, date range and program/status filters. Include year when relevant, paginate older lift records, and link every record to a source session. Current workout history offers only an older-page cursor, and lift history silently stops after 16 rows (`src/app/workouts/page.tsx:7`, `src/components/LiftDetailContent.tsx:103`).
4. **Explain progression separately from performance.** Expose the saved before/after decisions: why a target increased, held, reset or deloaded. These decisions are already stored at completion (`src/features/program-editor/execution.ts:135–157`). A prescribed increase is not evidence that the user actually lifted more; the current evaluator considers recorded reps, not actual weight.
5. **Show correction details.** Expand an entry to reveal before/after reps, load and date, alongside its reason and timestamp. The database already stores this; the UI exposes only reason/time (`src/features/workouts/history-service.ts:263–273`, `src/components/WorkoutHistoryDetail.tsx:92`). Preserve the existing rule that corrections update historical reporting without replaying future progression.
6. **Review a program block after the basic metrics are dependable.** Show completed versus eligible scheduled workouts, actual work sets, comparable lift changes and stored holds/resets. Exclude future dates; handle pauses and skips explicitly. Let users inspect the sessions behind the summary. Optional pinned exercises and personal goals can follow this.

The current featured-lift selector prefers main Squat/Bench/Deadlift matches and otherwise falls back to three lifts by volume. It is not an all-exercise index (`src/features/programs/training-stats.ts:102`). This particularly disadvantages accessory and prehab tracking.

## Shared metric contract

| Measure | Proposed definition |
| --- | --- |
| Workouts | Distinct completed session IDs; distinguish empty finishes and partially recorded workouts |
| Recorded sets | Actual reps are non-null, retaining zero-rep attempts; preserve legacy set multiplicity |
| Work sets | Recorded non-warmup sets; old records with unknown roles stay unknown |
| External-load volume | Actual reps × recorded external weight × multiplicity; normalize units before aggregation and report missing-weight coverage |
| Exercise improvement | Comparable actual load/reps and dated rep/load records, with movement and equipment context |
| Estimated 1RM | Explicit estimate with formula, source set/date and defined movement/rep eligibility; not the default metric for every exercise |
| Target attainment | Actuals compared with that workout's frozen prescription, with unrecorded and partial results explicit |
| Adherence | Completed eligible scheduled occurrences divided by eligible due occurrences; separate unscheduled workouts, future slots, skips and planned pauses |
| Program progression | Recorded before/after decision events, separate from actual performance |

Use one user-scoped query model carrying session/set IDs, original units and labels, canonical load, actual/null values, performed date, frozen set role/load mode and correction revision. Overview, detail, PRs and export should derive from this model. Keep SQLite and the current application structure; add targeted indexes only after measuring realistic history queries. Fix grouping, export and date-window defects without a schema migration. Exercise identity and new structured measurements require deliberate migrations with populated-database recovery tests.

## Delivery order

| Slice | Outcome | Relative scope and dependencies |
| --- | --- | --- |
| 1. Trustworthy history | Correct export, session IDs, user-local weeks, historical PR semantics, zero-load records and explicit labels | Small to medium; mostly existing data and shared queries |
| 2. Connected Progress | Progress/History navigation, all-exercise discovery, exact workout links, searchable/paginated history, dated accessible charts and comparable-session views | Medium; uses slice 1 contract. Gate cross-program merging/comparisons on explicit exercise identity |
| 3. Explain training decisions | Stored progression timeline, visible correction diffs and a program-block review | Medium; reuse saved events and define adherence before showing scores |
| 4. Broader tracking and resilience | Band/equipment fields, optional actual effort and pinned goals; offline reopening if wanted | Separate scoped decisions and data migrations as needed |

The offline distinction matters: existing drafts and retry handling protect unsaved work, while the service worker currently caches only icons and the manifest. Reloading or reopening the app without a network is a separate capability (`public/sw.js:2`). It should receive its own testable design rather than being implied by existing retry support.

## Design guidance and acceptance criteria

Provide a visible explanation and values table/list for meaningful charts. [W3C complex-image guidance](https://www.w3.org/WAI/tutorials/images/complex/) supports textual access to the values and relationships shown visually. The current chart primitives are all hidden from assistive technology, and the surrounding content does not expose the full dated series (`src/components/Charts.tsx:17,62,121`). This is a source-confirmed accessibility gap.

Retain stable navigation and disclose chart detail progressively, informed by [Apple tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [Apple chart experience guidance](https://developer.apple.com/videos/play/wwdc2022/110342/). Use explicit dates, units, meaningful scales and visible labels; the current sparkline spaces observations uniformly, independently rescales each series, and does not show elapsed time. See [Apple chart design guidance](https://developer.apple.com/videos/play/wwdc2022/110340/).

- Every comparison names its metric, units, period and baseline. A partial current week says “so far.” Less volume during a deload is not automatically labelled regression.
- Every record can open its source workout. All logged exercises remain discoverable, including zero-load movements.
- No-data, one-session, no-filter-results and insufficient-comparison states differ. Missing values do not become zero. A single actual result remains useful before a trend exists.
- At 393px and 320px, with enlarged text and both themes: no clipped names/values, 44px controls, one document scroll and proper bottom-navigation clearance. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) defines the 320 CSS-pixel criterion; 44px is Magni's project target.
- Full-page exercise details suit the phone. If retaining a modal, implement focus placement/containment, Escape, background exclusion and focus return. The current lift modal declares `aria-modal` without that behavior (`src/app/history/page.tsx:205`); browser confirmation was not obtained in this audit.
- Preserve archived-program history, frozen prescriptions, ownership, revision conflicts, retry idempotency and progression applied once.

## Verification plan and evidence

Root executed unchanged source bodies from `training-stats.ts`, `date-key.ts` and the CSV route against an in-memory synthetic SQLite database. The harness checks the actual Git revision and compares every loaded source file to its committed content, recording hashes. Only module imports were replaced with the disposable database and a fixed authenticated user. It reproduced unlogged export rows, missing CSV units, same-day lift-session collapse, zero-load exclusion and disagreement between session PRs and the chronological PR timeline. It executed Stats' Sunday boundary; Calendar's Monday boundary was corroborated in source.

Evidence: `.playwright/system-audit-20261006/probe.mjs`, `probe-result.json`, and `probe.log`. The independent verifier accepted the probe's narrow conclusions. These are source-level execution checks, not HTTP authentication, browser, production, or full-schema integration tests.

The local disposable screenshot server did not reach readiness while loading the cloud-managed dependencies. It was stopped, and no fresh screenshots are claimed. Layout recommendations are based on source and the existing design system, with rendered verification required during implementation. No physical iPhone test or production-data inspection was performed. No full release suite was rerun for this audit.

Future regression coverage should include:

- Complete → exact history record → Progress → correction → refreshed charts/export → next workout. Corrected history changes; recorded progression is not replayed.
- Two workouts on one date; 120 workouts; more than 16 exercise dates; dates across years; sparse histories; identical values; backdated corrections and old PRs.
- Mixed kg/lb, null versus zero, zero external load, missing actual weight, legacy set counts, known/unknown warmup roles, case variants and explicit rename/variant mappings.
- User/server timezone differences and Sunday/Monday boundaries; archived programs; stable source links and ownership isolation.
- Keyboard-only chart/detail navigation, accessible dated values, focus return, mobile viewport screenshots and enlarged text.
- If offline reopening is added: close/reopen while disconnected, reconnect and save once; then repeat with expired authentication and a conflicting server revision.

## Audit completion

- [x] Remote compared and unrelated work preserved.
- [x] Backend, design/research and independent verification handoffs consolidated.
- [x] Material calculation findings reproduced and evidence limits stated.
- [x] Priorities, architecture, design direction and acceptance tests recorded.
- [x] No application or deployment changes made.

Independent verification reviewed the completed report and accepted its evidence boundaries, dependency ordering, and preservation of existing data semantics with no material findings.

The recommended next implementation scope is slices 1 and 2, beginning with trustworthy historical calculations and export. Slice 3 then turns the data already stored into useful explanations and program reviews.
