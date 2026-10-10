# Progress insights implementation plan

**Goal:** Make Big three the default Progress graph, with useful individual strength comparisons and training activity, and readable iPhone 13 mini and iPhone 16 layouts.

**Architecture:** Keep the existing exercise identity, date/metric URLs, SVG chart and workout evidence routes. Add bounded read-only full-range metric summaries and activity context; no schema, training-write, alias or progression changes. Keep chart points capped at 120 and clearly distinguish the plotted window from full-range summaries.

**Tech stack:** Next.js 16.3.8 App Router, React, SQLite, semantic Tailwind tokens, Vitest, Playwright Chromium/WebKit.

## Baseline and scope

- Fetched `origin` before edits; `9d125e7` matches remote main (0 ahead/behind).
- Reuse clean `.worktrees/unified-exercise-cards` checkout. Preserve four unrelated untracked plans in primary checkout.
- User selected **a balance of strength trends/personal bests and consistency/training volume**.
- Read AGENTS, design system, engineering team, original objective/review/roadmap and installed Next router/client-component guides.
- Skills: brainstorming and writing-plans for scope; subagent-driven development for bounded ownership; meaningful data/interaction regressions before implementation; independent verification before completion.

## Design decisions

Considered: (1) cosmetic tightening alone, (2) compact strength and activity insights with one inspectable graph (chosen), (3) multi-chart dashboard. The chosen approach adds useful context without a growing list or another dashboard to manage.

1. Keep Progress + History header, single lift chooser, Squat/Bench/Deadlift first, search for everything else, All time default.
2. Reduce chooser and chart framing. Label the latest metric with its date. Show comparison with the preceding eligible workout and best in the selected period, each with explicit context. Use neutral treatment for decreases and rep-volume differences, not unsupported coaching judgments.
3. Allow inspecting a dated graph point and opening its workout. Supply previous/next buttons and a complete dated table so tiny or overlapping points are never the sole interaction. Same-day workouts remain separate.
4. Use rounded readable axis ticks; preserve exact actual values and true date spacing. Clearly label estimated max and its limitations. Retain missing-value gaps and original-unit series.
5. Add one compact **Training in this range** section: workouts, recorded sets, original-unit load volume, active weeks and last trained date. No invented consistency goal, streak or adherence percentage. Missing loads remain excluded and explained.
6. Full-range best/previous come from uncapped owned SQL aggregation, never the plotted subset. Show truncation honestly. No PR badges based only on a short period.
7. At enlarged text, controls, stats and recent-workout rows reflow. At normal Mini/16 widths prioritize chart and its latest context; no horizontal scroll. Preserve 44px controls, focus, safe areas and bottom-nav clearance in both themes.
8. New user steering: add a combined Squat/Bench/Deadlift graph and **make Big three the default**. Offer **One exercise / Big three** views with period/metric preserved in URLs. Big three uses one shared date/value scale and original unit, distinct semantic colors plus line/marker styles, three bounded latest-value/source rows and individual-lift drilldown. Preserve explicit exercise links and separations and show missing/ambiguous histories honestly. Do not invent normalized strength or total scores. Only load the three owned detail queries when comparison is selected. Provide a dated-value alternative and clear cap/estimate explanations.

Research: [Apple chart guidance](https://developer.apple.com/design/human-interface-guidelines/charts) supports clear summaries, selection and drill-down; [W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/) supports an accessible text/data alternative. [WCAG resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) inform acceptance. Project 44px targets exceed WCAG's usual 24px minimum. Active weeks are a descriptive count of Monday-based weeks containing recorded sets, not adherence.

## Ownership and task graph

- Coordinator: plan, integration, `tests/e2e/progress-insights.spec.ts`, design-system documentation, runtime/screenshots, Git and release.
- Designer `progress_design`: read-only research and layout review; inspect coordinator screenshots.
- Backend `progress_contract_audit`: `src/features/progress/types.ts`, `queries.ts`, `queries.test.ts`. Full-range summaries and selected-exercise activity with no migration. Publish contract before frontend integration.
- Frontend `progress_frontend`: `ProgressOverview.tsx`, `ExerciseProgressChart.tsx`, `ExerciseChooser.tsx`, helper components/model and focused component tests; after new steering also owns `PrimaryLiftComparison.tsx`, view navigation and `src/app/history/page.tsx` integration.
- Coordinator also passes full-range summaries to the existing individual exercise detail route.
- Independent verification: requirements first, correctness/accessibility second; no implementation edits.

## Implementation and acceptance

### 1. Read-only summaries

- Add compatible optional contracts (always emitted by live queries) for up to five metric summaries: metric/count/first/latest/previous/best, dated workout evidence, original unit, reps/set counts.
- Reuse metric eligibility for chart and summary SQL; bounded result, full selected-range scan. Add training active-week count/date span/original-unit volumes.
- Red/green regression tests: old best and previous beyond 120 sessions; separate units; missing/zero load and failed attempts; same-day ordering/ties; filters; ownership; correction freshness; no data mutation.
- Run focused query suite with Node 22.

### 2. Compact interactive view

- Implement latest/best/comparison context, rounded chart axes, accessible point selection and workout link; keep URL state and all evidence paths.
- Implement compact range activity and responsive chooser/recent rows.
- Meaningful component regressions: selection/keyboard navigation; missing metric and old-unit outside plotted window; one result; no divide-by-zero or invented PR; source links retain return URL; context resets when metric/range/exercise changes.
- Run component suites and typecheck.

### 3. Browser and visual verification

- Disposable fixtures with multiple dates, same-day entries, original units and zero/missing values; no live user data writes.
- Test latest/previous/best, point selection + source/back, date and metric filters, activity agreement and correction freshness.
- Capture actual WebKit at 375px Mini and 393px iPhone16 widths, normal/20px/32px text, light/dark. Inspect screenshots; fix clipping/tiny columns and overlapping labels.
- Independently review specification then code quality and evidence.

### 4. Release

- Run required typecheck, lint, unit/coverage, production build and relevant E2E; CI runs full release suite before publication.
- Refresh remote comparison before integration. Preserve unrelated work. Commit/push authorized changes only after local review.
- Current live baseline is schema6/9d125e7 and Watchtower is running. Guard publication/promotion and staging using the current baseline; do not blindly rerun previous schema5 migration scripts.
- Record immutable revision, staging and live checks separately. Physical-device verification remains a separate limitation unless an actual connected device is tested.

## Evidence and remaining work

- [x] Remote baseline and current code/screenshots inspected.
- [x] User preference and bounded scope recorded.
- [x] Data and UI implementation.
- [x] Independent code review and mobile screenshots.
- [ ] Release checks, staging, publication and live verification.

### Local verification

- Full unit/coverage run: 106 files, **994 tests passed**; statements 87.27%, branches 80.74%, functions 94.17%, lines 90.03%. Thresholds unchanged.
- Independent final focused review: **89 tests passed** across eight query/component/route/helper suites. Decimal-load display and cancellation-noise findings reproduced and repaired; estimates remain approximate.
- Full lint with zero warnings, production dependency audit (zero vulnerabilities), route generation, typecheck, production build and ten release-policy/maintenance tests passed.
- Existing identity/discovery journeys passed in both engines. One development navigation timeout did not reproduce in three isolated runs; no timeouts or assertions were weakened.
- Final insight journeys: **8/8 Chromium/WebKit cases passed, zero retries**. Covers full-range latest/best/previous, same-day inspection, original units, missing/zero/failed sets, correction freshness, Big three default, preserved filters, individual drilldown and keyboard inspection/source/back.
- Broader workout integration: **14/14 Chromium/WebKit cases passed, zero retries** for scheduled completion/skip/catch-up, quick-workout recovery, history corrections/repeat/routines and kg activity. Two existing journeys reproduced stale single-view expectations; they now verify Big three and use the Squat drilldown while retaining every original assertion. Independent audit found no other stale default-view expectations. The initial CI run was canceled before publication to include these test updates.
- Stable screenshots: `.playwright/progress-insights/visual-review/`. Mini 375px and iPhone16 393px, light/dark, 16/20/32px text, browser/PWA-sized viewports, and desktop 1440px. Independent mobile/desktop review inspected twelve renders, closed header/chooser overlaps and found no blocking layout issue. These are simulated viewports, not physical-device validation.
- Logs: `.playwright/progress-insights/{coverage-local,lint-local,gate-policy-local,e2e-local,e2e-final,build-local}.log`.
- No schema or write-path change. Reusable same-schema6 release receipts live under `.playwright/progress-insights/release/`: publication, populated-copy backup/restore/rollback, disposable production-image browser tests, guarded promotion and final health. Actual receipts, rather than this pre-publication checklist, establish rollout status.

### Browser release-gate repair

- CI run `38071437674` at `cf339e8` passed the first seven gates, then rejected six retry-pass WebKit cases out of 186. Publication was blocked; production remained healthy on `9d125e7` with the updater deliberately paused and baseline backup verified.
- Two independent trace audits found successful writes/correct response content, with requests pending beside Fast Refresh and development compilation. Examples: program navigation 4.893s against a 5s assertion; recovery's final correct assertions at 30.051s against its 30s budget; discovery's final navigation began at 29.475s. No application-data or hydration failure was observed. Detailed server compilation timing was not captured, so attribution to compilation is supported by timing/HMR evidence rather than direct server profiles.
- Repair only the disposable E2E harness: prepare the 23 page and 52 API entries using one normally registered setup account before journey deadlines; use GET pages and automatic OPTIONS handlers, strict response/auth checks and bounded setup time. Keep development entries for the bounded run using installed Next `onDemandEntries` settings, enabled only by the isolated launcher. Keep setup cookies out of browser contexts and logs. Explicitly wait for Programs to render in the recovery navigation test.
- Real registration tests, production auth policy, all assertions, per-test timeouts, retries and `--fail-on-flaky-tests` remain intact. This is still a development-server gate; immutable production-image staging is a separate required gate. Switching the whole suite to production would require changing allowlisted-account and per-client registration fixtures and is deferred from this bounded repair.
- Harness regressions cover separate databases/output, real route-method plans, localhost restriction, unsupported routes/collisions, custom or re-exported OPTIONS, rejected auth redirects/server errors/static404, and accepted missing dynamic placeholder records. Independent code review found no blocker; wildcard re-export safeguard was added after review.
- Repeated browser evidence: **76/76 cases passed**, zero retries, 4.9m (`.playwright/progress-insights/e2e-prepared-routes.log`). Final strict preparation prepared all 75 routes in 40.6s and passed **12/12 cases** across both engines, zero retries (`e2e-preparation-final.log`). Typecheck, full zero-warning lint, fresh production build and 11 release-policy/maintenance/harness tests passed. New CI, staging and live receipts establish the remaining release gates.

Deferred: configurable training goals, weekly adherence targets, additional dashboard types, load-mode/estimate formula redesign, automatic coaching recommendations.
