# Graph-first Progress with bounded discovery

Date: October 6, 2026. Designer specification and screenshot review for the approved history accuracy and connected Progress/History work. The user approved a graph-first mock: one selected exercise, one graph, three favorite shortcuts and two recent source workouts. This is the current direction and replaces the earlier list-first overview. Today stays focused on training; desktop program authoring stays separate.

## Decision and alternatives

Progress must remain useful after 200 or 1,000 logged exercise names. Pagination alone does not solve a home screen filled with exercise rows. The main task is to inspect one exercise's recorded progress and reach its evidence, with a quick way to change exercises.

| Approach | Strength | Limitation | Role in the approved design |
| --- | --- | --- | --- |
| Search-first personal history | Scales without a growing home feed | Requires recall and an extra step for familiar exercises | Search inside the exercise chooser; complete discovery on a dedicated finder |
| Bounded favorite/recent dashboard | Familiar exercises are easy to reach | Several rows or charts can still dominate the phone | Three compact favorite shortcuts and bounded chooser suggestions, surrounding one graph |
| Program/group navigation | Helps when the person remembers training context | Repeated exercises, archived plans and unplanned workouts complicate hierarchy | Secondary finder filters/browsing, never an expanded home tree |

The numeric limits are Magni product decisions, not requirements from the external guidance. Keep the existing five primary destinations, with Progress replacing Stats. History is an explicit action inside Progress and source workouts link back to the selected exercise's context.

## Approved phone hierarchy

```text
Progress                                  [History]

[ Bench press                         chooser icon ]
[ Change exercise                                  ]

[Bench press] [Dumbbell row] [Band shoulder rotation]
                         at most 3 favorite shortcuts

┌──────────────────────────────────────────────────┐
│ [Metric ▾]                           [12 weeks ▾] │
│ Latest value + unit       change + baseline date │
│                                                  │
│ One date-spaced graph with readable value labels │
│                                                  │
│ Short explanation of the selected metric         │
│ ▸ Dated chart values                             │
└──────────────────────────────────────────────────┘

Recent workouts
Date + workout name                actual-set result
Date + workout name                actual-set result
                  [All recorded workouts (count)]

▸ Recorded activity
```

- The full-width exercise control is the main switching action. Its current name and “Change exercise” label make its purpose clear. An unlinked name group instead explains that the person must choose which records belong together.
- Show at most **three** favorite shortcuts. They wrap naturally when names or text sizes require it. The storage limit remains **four** favorites; the fourth is available through the chooser and Manage favorites. Do not silently delete or replace a saved favorite to meet the home display limit.
- Show **one** chart for the selected exercise. Selecting another exercise replaces that content; it does not append a card. Metric and period controls belong with the chart.
- Show at most **two** recent source-workout rows for the selected exercise, with performed date, workout name and an actual result. Keep same-day workouts separate. The full recorded-workout list is a deliberate navigation action.
- Recorded activity is collapsed by default. Its period, counts, volume units and explanatory detail do not compete with the selected exercise's graph. Volume is a workload description, not evidence of strength gain.
- Home has no all-exercise list, infinite feed, Load more control or expanded program tree. Neither new logs nor a larger library increases these visible content caps.
- A desktop can use a comfortable centered training column. It retains the same limits and hierarchy; it does not fill unused width with additional charts or lists.
- At default phone text size without an install banner, the exercise selector and graph are the initial-view priorities. Larger text and optional banners may move part of the graph below the fold. Use normal document scrolling rather than fixed-height clipping to force everything into a single screen.

## Honest chart and source evidence

The selected metric determines the meaning of the headline, line and comparison. Available choices include estimated maximum, heaviest completed set and recorded repetitions where the data supports them. Do not treat these measurements as interchangeable or imply that prescribed loads were performed.

- Show the selected unit beside the headline and in the dated values. Preserve recorded unit context; do not silently combine kilogram and pound series under one unlabeled scale.
- Position observations by their actual dates. Same-day sessions may share a horizontal position, while their workout identifiers and source rows remain distinct. Do not collapse them into one record for visual convenience.
- Provide readable vertical-axis values and meaningful date labels. A nonzero line-chart range is acceptable when explicit; do not introduce a filled area or bars that exaggerate the baseline.
- Label estimates as estimates and state that an estimated maximum is not a tested maximum. A positive or negative difference is a dated comparison within the displayed evidence, not a diagnosis or a claim of statistically established improvement.
- Missing values remain missing. Zero external load can be valid; zero-repetition attempts must not become completed-set records or estimated maxima. Repetition-based evidence is useful when load-based metrics are unavailable.
- One observation can show its value and “One recorded workout”; it cannot provide a before/after claim. Empty periods provide a route to a wider range, without drawing invented zeroes.
- Put exact dated values and source-workout links behind **Dated chart values**. A chart tooltip, color or pointer interaction is never the only way to inspect the evidence.
- The chart response is capped at **120 workout observations**. Disclose truncation and provide a route to narrower date filtering/full history. Do not imply that a displayed subset or its baseline covers all recorded history.

## Exercise chooser and complete finder

The chooser is a deliberate modal interaction optimized for switching the displayed exercise. It has a heading, Close button, visible **Search exercises** label, current selection checkmark and bounded suggestions. A longer search or organization task can continue through **Browse all exercises** or **Manage favorites**.

- With a blank query, show at most **seven** deduplicated suggestions drawn from up to four favorites and three recent unpinned results. “Favorites and recently trained” identifies the scope. Do not request/render all names on open.
- Recent means a performed workout date in the preceding 12 weeks, not an import, view or correction-save timestamp. Inactive history remains searchable even when it no longer qualifies as a recent suggestion.
- Search returns at most **20** summaries per page. Previous/Next replace rows instead of appending them. Search current names and known historical labels, but retrieval matches never establish exercise identity.
- The dedicated finder supports deliberate alphabetical browsing and program filters. Program browsing returns at most **10** group summaries and fetches at most **20** exercise summaries after a group is chosen. Include unplanned and archived context without opening every group at once.
- Preserve the query, filters, selected exercise, metric, range and return destination as appropriate to the navigation. Visiting a source workout must provide a useful return to Progress rather than losing the investigation context.
- Long exercise names wrap. Show distinguishing equipment/variant or historical context when it resolves ambiguity; omit generic labels and repeated counts that add no meaning.
- A search failure retains the query and offers Retry. A no-match state names the query and offers a way to clear it or its filters. Neither means that the person has no workout history.

With no favorites, omit the shortcut strip; the chooser and available recent exercise still make Progress useful. With no recent activity, retain older favorites and searchable history. With no recorded evidence at all, explain what will appear after logging and offer an appropriate path to training/history; do not show a fabricated graph or empty favorite slots. Managing favorites is optional, not an onboarding chore.

## Identity and historical linking

Names alone are not reliable exercise identities. Bench variations can share a label, while a repeated quick workout should not generate hundreds of indistinguishable finder rows. Keep retrieval grouping separate from verified comparison history.

- Known stable exercise/source associations may connect repeated observations. Preserve their scope and recorded data. Name equality alone must not silently merge other exercises or replay progression decisions.
- Unlinked observations may be grouped by normalized recorded name solely for discovery, labelled as matching records. Such a result can show its latest single observation and source context; it cannot claim a combined progress trend, personal record or average.
- A personal followed-exercise identity records the user's explicit association of observations. Its personal name and favorites do not rewrite historical labels, sets, units, prescriptions or progression events.
- Archiving a program does not erase its workout history. Duplicate labels require distinguishing context, not automatic merging. A separate exercise-archive chore is unnecessary to keep home small.

The following is the historical-linking interaction contract for integration, not a claim that every step has been visually verified:

1. **Follow as one exercise** starts from an exact observation or a matching-record group. Select only the exact starting observation; a name group does not preselect all matching records.
2. Accept/edit a personal label and optional distinguishing context. **Choose past workouts** shows up to 20 candidate observations per page with recorded name, performed date, workout/program and useful actual-set evidence.
3. Checkboxes preserve selections across pages and expose the selected count. “Select these 20 records” affects only the visible page. Saving uses the reviewed observation IDs rather than a live name query that could change after review.
4. Review the number of observations/workouts and date span, then save. Explain that grouping affects Progress and preserves recorded workouts and the training plan. A person can follow one observation immediately and add others later; organizing all 200 names is never required.
5. **Edit included workouts** allows removal without deletion. Moving an already-linked observation names the affected group explicitly. Unfollowing preserves every workout. Future source bindings must be explicit or backed by an already reliable exercise identifier; a matching new name alone does not join a history.

Backend owners remain responsible for ownership, revisions, unit eligibility and identity validation. Corrections update the source evidence through its stable reference and retain the existing rule that historical edits do not replay future progression.

## Query and rendering bounds

| Surface | Bound |
| --- | --- |
| Progress home chart | 1 selected exercise; at most 120 workout observations, with truncation disclosure |
| Progress favorite shortcuts | 3 rendered; 4 saved favorites remain available in management/chooser |
| Progress recent source workouts | 2 rendered |
| Blank chooser | 7 deduplicated suggestions from at most 4 favorites and 3 recent results |
| Search/alphabetical browse | 20 summaries per page; fetch 21 only for a next-page flag |
| Program browser | 10 group summaries; no eager child lists |
| Selected program exercises | 20 summaries per page |
| Source workouts/candidate observations | 20 records per page |

Apply limits to user-scoped queries; do not fetch every exercise and every historical set merely to slice a home list in the browser. Fetch bounded summaries and the selected exercise's bounded series. Pagination and ordering must be deterministic; reset the cursor when query/scope changes. Measure the underlying database work at realistic sizes because a small response does not itself establish an efficient query.

## Accessibility and acceptance criteria

Use Magni's semantic colors, Barlow typography, surface patterns and safe-area spacing. Reserve orange for the selected state, meaningful action and plotted series. Selection also has semantic state and a visible check in the chooser.

- Interactive targets meet the project's 44px standard. Inputs retain readable text and visible focus. Meaningful name suffixes, units and numbers wrap rather than disappear behind truncation.
- Opening the chooser is deliberate, so focusing its search input is appropriate. Keep keyboard focus inside the open dialog, make the background inert, support Escape and Close, and return focus to the trigger when dismissing. A pointer/touch selection must update the graph without trapping focus in removed content.
- Search has a visible label and appropriate search semantics. Announce settled result counts, no matches and errors without announcing every result or moving focus unexpectedly. Ignore stale asynchronous results.
- Ensure the modal's contained scroll reaches every result and footer action. Complete browse and historical-selection flows also have dedicated pages, so a long task does not depend solely on the switching modal.
- Verify 393px and 320px layouts, enlarged text, light/dark themes and installed-PWA safe areas. No horizontal document overflow; content can scroll clear of the bottom navigation. Do not shrink text or controls to satisfy a page-height target.
- Verify zero/four favorites and replacement behavior, inactive history, no data, one observation, long/duplicate names, unlinked groups, archived programs, failed/no-match search, same-day workouts, missing and zero loads, differing units and source corrections.
- With 200 and 1,000 names, confirm the same one-chart/three-shortcut/two-workout home structure and 20-result search bound. Locate a late alphabetic item directly through search and return from its source workout without traversing earlier names or losing the selected context.
- Keyboard/screen-reader checks must cover chart-value disclosure, result selection, chooser focus restoration, pagination and historical linking. Screenshots cannot establish those behaviors or the correctness of metric/identity calculations.

## Primary-source research

- [Apple, Design intuitive search experiences (WWDC26)](https://developer.apple.com/videos/play/wwdc2026/292/): make search scope clear, keep suggestions selective and provide contextual filtering and explicit no-results feedback. This supports the scoped chooser plus deliberate complete finder.
- [Apple, Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls): keep common controls visible and reveal less-frequent detail when useful. This informs collapsed activity, exact chart values and secondary organization flows.
- [Apple, Design app experiences with charts](https://developer.apple.com/videos/play/wwdc2022/110342/): charts should support the task and expose complexity progressively. Magni's approved task is inspection of one selected exercise, rather than scanning a growing collection of charts.
- [Apple, Design an effective chart](https://developer.apple.com/videos/play/wwdc2022/110340/): establish a clear chart purpose and support understanding with useful scales, labels and accessible evidence. This informs explicit dates/units and the companion dated-value table.
- [W3C, Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): keyboard focus, Escape, background modality and returning focus to the invoking context define the chooser's interaction requirements.
- [W3C, Search landmark](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/search.html) and [Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): expose search semantics and dynamic result status without forcing a context change or reading the complete list.
- [W3C, Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): non-excepted content remains usable at an equivalent width of 320 CSS pixels. Magni's 44px target size is a project standard.
- [W3C, Complex images](https://www.w3.org/WAI/tutorials/images/complex/): provide textual access to important chart values and relationships.

## Actual visual review and evidence limits

The designer inspected these final actual screenshots under `.playwright/progress/` in this worktree:

- `iphone-graph-viewport.png`
- `iphone-graph-full.png`
- `iphone-chooser-viewport.png`
- `iphone-dark-large-viewport.png`
- `iphone-dark-large-full.png`
- `desktop-graph-viewport.png`
- `desktop-chooser-viewport.png`

The final captures use the fixture's saved dark preference. The additional `iphone-200-graph.png` and `iphone-200-chooser.png` were inspected for the light appearance, including its visible install banner.

**Visual acceptance: no material remaining finding in the reviewed states.** The selected exercise is prominent; the graph has readable value/date axes, a unit-labelled headline, baseline comparison and estimate explanation. Three favorite shortcuts stay compact while the long band-exercise label wraps. Two recent workout rows expose distinct actual results for same-day sessions. The chooser has an explicit search label, clear selected check and readable controls; its desktop footer exposes complete browse and favorite management. The enlarged dark layout preserves readable controls and content through normal scrolling. The desktop's centered column preserves the hierarchy without adding a second feed.

Fixed navigation appearing midway down full-page screenshots is the known capture artifact; it is not evidence of a new overlay defect. Actual viewport captures and the runtime owner's geometry checks are the appropriate evidence for navigation clearance.

The coordinator reports successful WebKit fixtures with 200/1,000 names covering constant content caps, search, source-workout return and overflow. These tests were not rerun by the designer. Chooser focus behavior is being verified separately by the frontend/runtime owners; this visual review does not close that interaction gate or data-integrity/release checks. Later metric selection may change the displayed numbers while retaining this accepted hierarchy. Only this design note was edited; no application code, browser runtime, build or Git state was changed by the designer.

Runtime follow-up: the coordinator subsequently verified metric/period focus, chooser selection focus, Escape return, and enlarged-text reflow in both actual WebKit and Chromium sessions. These runtime checks are separate from the designer's screenshot review.
